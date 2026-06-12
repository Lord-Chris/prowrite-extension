import { useState, useEffect } from "react";
import { getAccessToken } from "../../lib/auth";
import { extractJobDetails, saveJob, generateDocuments } from "../../lib/api";
import type { ExtractedJob } from "../../lib/api";
import Logo from "../../components/Logo";

type State =
  | { phase: "checking-auth" }
  | { phase: "no-auth" }
  | { phase: "checking-page" }
  | { phase: "not-job-page"; url: string; text: string }
  | { phase: "extracting" }
  | { phase: "preview"; job: ExtractedJob; pageUrl: string }
  | { phase: "saving" }
  | { phase: "generating" }
  | {
      phase: "done";
      contentSnapshot?: any;
      coverLetter?: string;
      jobUrl?: string;
      title?: string;
      company?: string;
    }
  | { phase: "error"; message: string };

async function getPageContent(): Promise<{ url: string; text: string }> {
  const stored = await chrome.storage.local.get<{
    pendingPageContent?: { url: string; text: string };
    pendingPageError?: string;
  }>(["pendingPageContent", "pendingPageError"]);

  if (stored.pendingPageError) {
    const err = stored.pendingPageError;
    await chrome.storage.local.remove(["pendingPageContent", "pendingPageError"]);
    throw new Error(err);
  }

  if (!stored.pendingPageContent) {
    throw new Error("No page content available. Try clicking the extension icon again.");
  }

  const content = stored.pendingPageContent;
  await chrome.storage.local.remove(["pendingPageContent", "pendingPageError"]);
  return content;
}

const JOB_KEYWORDS = [
  "job", "jobs", "hiring", "career", "careers",
  "position", "opening", "vacancy",
  "apply", "application", "submit your application",
  "responsibilities", "requirements", "qualifications",
  "salary", "compensation", "pay range",
  "experience required", "years of experience",
  "we are looking for", "join our team",
  "about the role", "about you", "key skills",
  "full-time", "part-time", "contract", "remote",
  "recruiter", "recruiting", "hr",
  "job description", "job posting", "job ad",
  "resume", "cv", "cover letter",
];

const JOB_URL_PATTERNS = [
  /job[s]?\//i, /career[s]?\//i, /position[s]?\//i,
  /vacanc[yies]\/?/i, /opening[s]?\//i,
  /jobs\b/i, /\bcareers?\b/i, /\bapply\b/i,
  /linkedin\.com\/jobs/i, /indeed\.com/i, /glassdoor\.com/i,
  /monster\.com/i, /ziprecruiter\.com/i,
  /workday\.com/i, /greenhouse\.io/i, /lever\.co/i,
  /bamboohr\.com/i, /smartrecruiters\.com/i,
];

function isJobPage(url: string, text: string): boolean {
  let score = 0;

  if (JOB_URL_PATTERNS.some((p) => p.test(url))) {
    score += 2;
  }

  const lower = text.toLowerCase();
  let hits = 0;
  for (const kw of JOB_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      hits++;
    }
  }

  if (hits >= 6) score += 3;
  else if (hits >= 3) score += 2;
  else if (hits >= 1) score += 1;

  if (/key responsibilities|what you('ll| will) do|about this (role|position)/i.test(text)) score += 1;
  if (/\$\d{2,}[kK]?\s*[-–—to]+\s*\$?\d{2,}[kK]?/i.test(text)) score += 1;
  if (/\b(mid|senior|junior|lead|principal|staff)\s+(engineer|developer|designer|manager|analyst|associate|consultant|coordinator|specialist)\b/i.test(text)) score += 1;

  return score >= 3;
}

const PROWRITE_APP_URL = import.meta.env.DEV ? "http://localhost:8080" : "https://my.prowrite.app";

function openProWrite(path: string) {
  chrome.tabs.create({ url: `${PROWRITE_APP_URL}${path}` });
}

function escapeHtml(text: unknown): string {
  const s = String(text ?? "");
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderResumeHTML(snapshot: any): string {
  if (!snapshot) return "";

  const c = snapshot;
  const parts: string[] = [`<div style="font-family:Georgia,serif;max-width:700px;margin:0 auto;padding:40px;color:#1a1a1a;font-size:11pt;line-height:1.5;">`];

  if (c.contactInfo?.full_name) {
    parts.push(`<div style="text-align:center;margin-bottom:16px;">`);
    parts.push(`<h1 style="font-size:20pt;margin:0;font-weight:700;">${escapeHtml(c.contactInfo.full_name)}</h1>`);
    if (c.profile?.preferred_title) {
      parts.push(`<p style="margin:4px 0 0;font-size:12pt;">${escapeHtml(c.profile.preferred_title)}</p>`);
    }
    const details = [
      c.contactInfo.email,
      c.contactInfo.phone,
      c.contactInfo.location,
    ].filter(Boolean).map(escapeHtml);
    if (details.length) {
      parts.push(`<p style="margin:4px 0 0;font-size:10pt;color:#555;">${details.join(" &nbsp;|&nbsp; ")}</p>`);
    }
    parts.push(`</div>`);
  }

  if (c.professionalSummary) {
    parts.push(`<h2 style="font-size:11pt;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;padding-bottom:2px;margin:16px 0 8px;">Summary</h2>`);
    parts.push(`<p style="margin:0 0 12px;">${escapeHtml(c.professionalSummary)}</p>`);
  }

  if (c.skills?.length) {
    parts.push(`<h2 style="font-size:11pt;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;padding-bottom:2px;margin:16px 0 8px;">Skills</h2>`);
    for (const cat of ["proficient", "familiar", "tools"]) {
      const items = c.skills.filter((s: any) => s.category === cat);
      if (!items.length) continue;
      const label = cat === "proficient" ? "Proficient" : cat === "familiar" ? "Familiar" : "Tools";
      parts.push(`<p style="margin:0 0 4px;"><strong>${label}:</strong> ${items.map((s: any) => escapeHtml(s.name)).join(", ")}</p>`);
    }
  }

  if (c.workExperiences?.length) {
    parts.push(`<h2 style="font-size:11pt;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;padding-bottom:2px;margin:16px 0 8px;">Experience</h2>`);
    for (const w of c.workExperiences) {
      const dates = [w.start_date, w.end_date || (w.is_current ? "Present" : "")].filter(Boolean).join(" — ");
      parts.push(`<div style="margin-bottom:8px;">`);
      parts.push(`<p style="margin:0;font-weight:600;">${escapeHtml(w.role)} at ${escapeHtml(w.company)}</p>`);
      if (dates) parts.push(`<p style="margin:0;font-size:10pt;color:#555;">${escapeHtml(dates)}</p>`);
      if (w.bullets?.length) {
        parts.push(`<ul style="margin:4px 0 0;padding-left:18px;">`);
        for (const b of w.bullets) {
          parts.push(`<li style="margin-bottom:2px;">${escapeHtml(b.content)}</li>`);
        }
        parts.push(`</ul>`);
      }
      parts.push(`</div>`);
    }
  }

  if (c.education?.length) {
    parts.push(`<h2 style="font-size:11pt;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;padding-bottom:2px;margin:16px 0 8px;">Education</h2>`);
    for (const e of c.education) {
      const dates = [e.start_date, e.end_date || (e.is_current ? "Present" : "")].filter(Boolean).join(" — ");
      parts.push(`<p style="margin:0 0 4px;"><strong>${escapeHtml(e.school)}</strong>`);
      if (e.degree) parts.push(` — ${escapeHtml(e.degree)}`);
      if (e.field_of_study) parts.push(` in ${escapeHtml(e.field_of_study)}`);
      if (dates) parts.push(`<br/><span style="color:#555;">${escapeHtml(dates)}</span>`);
      parts.push(`</p>`);
    }
  }

  if (c.projects?.length) {
    parts.push(`<h2 style="font-size:11pt;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;padding-bottom:2px;margin:16px 0 8px;">Projects</h2>`);
    for (const p of c.projects) {
      parts.push(`<p style="margin:0 0 2px;"><strong>${escapeHtml(p.name)}</strong>`);
      if (p.description) parts.push(` — ${escapeHtml(p.description)}`);
      parts.push(`</p>`);
    }
  }

  if (c.certifications?.length) {
    parts.push(`<h2 style="font-size:11pt;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;padding-bottom:2px;margin:16px 0 8px;">Certifications</h2>`);
    for (const cert of c.certifications) {
      parts.push(`<p style="margin:0 0 2px;"><strong>${escapeHtml(cert.name)}</strong>`);
      if (cert.issuer) parts.push(` — ${escapeHtml(cert.issuer)}`);
      parts.push(`</p>`);
    }
  }

  parts.push(`</div>`);
  return parts.join("\n");
}

function openPrintWindow(title: string, htmlContent: string) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@media print{body{margin:0;padding:20px}}</style></head><body>${htmlContent}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 300);
}

function formatCoverLetterHTML(text: string): string {
  return `<div style="font-family:Georgia,serif;max-width:650px;margin:0 auto;padding:40px;color:#1a1a1a;font-size:11pt;line-height:1.6;white-space:pre-wrap;">${escapeHtml(text).replace(/\n/g, "<br/>")}</div>`;
}

export default function App() {
  const [state, setState] = useState<State>({ phase: "checking-auth" });
  const [coverLetterExpanded, setCoverLetterExpanded] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      if (!token) {
        setState({ phase: "no-auth" });
        return;
      }

      setState({ phase: "checking-page" });

      try {
        const { url, text } = await getPageContent();

        if (!isJobPage(url, text)) {
          setState({ phase: "not-job-page", url, text });
          return;
        }

        setState({ phase: "extracting" });

        const job = await extractJobDetails(url, text);
        setState({ phase: "preview", job, pageUrl: url });
      } catch (e: any) {
        setState({ phase: "error", message: e.message || "Failed to extract job details" });
      }
    })();
  }, []);

  const handleForceExtract = async () => {
    if (state.phase !== "not-job-page") return;
    setState({ phase: "extracting" });
    try {
      const job = await extractJobDetails(state.url, state.text);
      setState({ phase: "preview", job, pageUrl: state.url });
    } catch (e: any) {
      setState({ phase: "error", message: e.message || "Failed to extract job details" });
    }
  };

  const handleSaveAndGenerate = async () => {
    if (state.phase !== "preview") return;

    setState({ phase: "saving" });

    try {
      const descParts = [
        `Key Responsibilities: ${state.job.key_responsibilities.join(", ")}`,
        `Required Skills: ${state.job.required_skills.join(", ")}`,
        `Years of Experience Required: ${state.job.years_of_experience_required}`,
      ];
      if (state.job.company_description) {
        descParts.push(`Company Description: ${state.job.company_description}`);
      }
      if (state.job.nice_to_have_skills?.length) {
        descParts.push(`Nice-to-Have Skills: ${state.job.nice_to_have_skills.join(", ")}`);
      }

      const jobId = await saveJob({
        title: state.job.job_title,
        company: state.job.company,
        job_link: state.pageUrl,
        job_description: descParts.join("\n\n"),
        status: "draft",
      });

      setState({ phase: "generating" });

      const docs = await generateDocuments(jobId);

      setState({
        phase: "done",
        contentSnapshot: docs?.cv?.contentSnapshot ?? null,
        coverLetter: docs?.coverLetter,
        jobUrl: jobId,
        title: state.job.job_title,
        company: state.job.company,
      });
    } catch (e: any) {
      if (e.message === "subscription_required") {
        setState({ phase: "error", message: "Your trial has ended. Subscribe to generate documents." });
      } else {
        setState({ phase: "error", message: e.message || "Something went wrong" });
      }
    }
  };

  const openResumePrint = () => {
    if (state.phase !== "done" || !state.contentSnapshot) return;
    const html = renderResumeHTML(state.contentSnapshot);
    openPrintWindow(`Resume - ${state.title} at ${state.company}`, html);
  };

  const openCoverLetterPrint = () => {
    if (state.phase !== "done" || !state.coverLetter) return;
    const html = formatCoverLetterHTML(state.coverLetter);
    openPrintWindow(`Cover Letter - ${state.title} at ${state.company}`, html);
  };

  const copyToClipboard = async (text: string | undefined) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  };

  return (
    <div className="popup">
      <header className="header">
        <Logo className="header-logo" />
        <h1>ProWrite</h1>
      </header>

      <main className="main">
        {state.phase === "checking-auth" && (
          <div className="center">
            <div className="spinner" />
            <p className="title">Checking login...</p>
          </div>
        )}

        {state.phase === "no-auth" && (
          <div className="center">
            <p className="icon">🔑</p>
            <p className="title">Log in to ProWrite</p>
            <p className="desc">Open ProWrite in your browser to connect your account, then try again.</p>
            <button className="btn btn-primary" onClick={() => openProWrite("/auth")}>
              Open ProWrite
            </button>
          </div>
        )}

        {state.phase === "checking-page" && (
          <div className="center">
            <div className="spinner" />
            <p className="title">Checking page...</p>
            <p className="desc">Checking if this is a job posting page.</p>
          </div>
        )}

        {state.phase === "not-job-page" && (
          <div className="center">
            <p className="icon">📋</p>
            <p className="title">Not a job page</p>
            <p className="desc">This doesn't appear to be a job posting. ProWrite works on job boards and career pages.</p>
            <div className="btn-group" style={{ marginTop: 4 }}>
              <button className="btn btn-secondary" onClick={() => window.close()}>Close</button>
              <button className="btn btn-primary" onClick={handleForceExtract}>Try anyway</button>
            </div>
          </div>
        )}

        {state.phase === "extracting" && (
          <div className="center">
            <div className="spinner" />
            <p className="title">Reading job details...</p>
            <p className="desc">Analyzing the page to extract job title, company, skills, and requirements.</p>
          </div>
        )}

        {state.phase === "preview" && (
          <div className="preview">
            <div className="preview-field">
              <label>Title</label>
              <p>{state.job.job_title}</p>
            </div>
            <div className="preview-field">
              <label>Company</label>
              <p>{state.job.company}</p>
            </div>
            <div className="preview-field">
              <label>Key Responsibilities</label>
              <p className="desc-text">{state.job.key_responsibilities.slice(0, 3).join(" • ")}{state.job.key_responsibilities.length > 3 ? " …" : ""}</p>
            </div>
            <div className="preview-field">
              <label>Required Skills</label>
              <p className="desc-text">{state.job.required_skills.join(", ")}</p>
            </div>
            <button className="btn btn-primary full" onClick={handleSaveAndGenerate}>
              Save & Generate Documents
            </button>
          </div>
        )}

        {state.phase === "saving" && (
          <div className="center">
            <div className="spinner" />
            <p className="title">Saving job...</p>
          </div>
        )}

        {state.phase === "generating" && (
          <div className="center">
            <div className="spinner" />
            <p className="title">Building your documents...</p>
            <p className="desc">Tailoring your resume and cover letter for this specific role.</p>
          </div>
        )}

        {state.phase === "done" && (
          <div className="done">
            <div className="done-header">
              <p className="icon">✅</p>
              <p className="title">{state.title} at {state.company}</p>
              <p className="desc">Documents generated successfully</p>
            </div>

            <div className="doc-section">
              <div className="doc-section-header">
                <span className="doc-icon">📄</span>
                <span>CV / Resume</span>
              </div>
              <button className="btn btn-secondary full" onClick={openResumePrint}>
                Download
              </button>
            </div>

            {state.coverLetter && (
              <div className="doc-section">
                <div className="doc-section-header">
                  <span className="doc-icon">✉️</span>
                  <span>Cover Letter</span>
                </div>
                {state.coverLetter.length > 200 && !coverLetterExpanded ? (
                  <p className="cl-preview">
                    {state.coverLetter.slice(0, 200)}...
                    <button className="link-btn" onClick={() => setCoverLetterExpanded(true)}>Show more</button>
                  </p>
                ) : (
                  <div className="cl-full">
                    <p className="cl-text">{state.coverLetter}</p>
                    {state.coverLetter.length > 200 && (
                      <button className="link-btn" onClick={() => setCoverLetterExpanded(false)}>Show less</button>
                    )}
                  </div>
                )}
                <div className="btn-group">
                  <button className="btn btn-secondary" onClick={() => copyToClipboard(state.coverLetter)}>
                    Copy
                  </button>
                  <button className="btn btn-secondary" onClick={openCoverLetterPrint}>
                    Download PDF
                  </button>
                </div>
              </div>
            )}

            <button className="btn btn-primary full" onClick={() => openProWrite(`/jobs/${state.jobUrl}`)}>
              View in ProWrite →
            </button>
          </div>
        )}

        {state.phase === "error" && (
          <div className="center">
            <p className="icon">⚠️</p>
            <p className="title">Something went wrong</p>
            <p className="desc">{state.message}</p>
            <button className="btn btn-primary full" onClick={() => window.close()}>
              Close
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
