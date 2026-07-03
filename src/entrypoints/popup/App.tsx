import { useState, useEffect } from "react";
import { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } from "docx";
import { getAccessToken, getUserDisplayName, getInitials } from "../../lib/auth";
import { extractJobDetails, saveJob, generateDocuments, AuthFetchError } from "../../lib/api";
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
      stylingSnapshot?: any;
      coverLetter?: string;
      jobUrl?: string;
      title?: string;
      company?: string;
    }
  | { phase: "error"; message: string; statusCode?: number; retry?: () => void };

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

function renderResumeHTML(snapshot: any, styling?: any): string {
  if (!snapshot) return "";

  const s = styling || {};
  const fontFamily = s.fontFamily || "Georgia";
  const fontSize = s.fontSize || 11;
  const headingFontFamily = s.headingFontFamily || "Georgia";
  const headingFontSize = s.headingFontSize || 14;
  const headingFontWeight = s.headingFontWeight || "bold";
  const lineHeight = s.lineHeight || 1.5;
  const sectionSpacing = s.sectionSpacing || 12;
  const bulletSpacing = s.bulletSpacing || 4;
  const marginTop = s.marginTop ?? 40;
  const marginBottom = s.marginBottom ?? 40;
  const marginLeft = s.marginLeft ?? 50;
  const marginRight = s.marginRight ?? 50;
  const alignment = s.alignment || "left";

  const sectionMap: Record<string, { sort_order: number; is_visible: boolean }> = {};
  if (snapshot.sectionOrder) {
    for (const so of snapshot.sectionOrder) {
      sectionMap[so.section_type] = so;
    }
  }

  function isVisible(type: string): boolean {
    if (!snapshot.sectionOrder) return true;
    return sectionMap[type]?.is_visible ?? true;
  }

  const textAlign = alignment === "center" ? "center" : alignment === "right" ? "right" : "left";

  const parts: string[] = [];

  parts.push(`<div style="font-family:${fontFamily},serif;max-width:700px;margin:0 auto;padding:${marginTop}px ${marginRight}px ${marginBottom}px ${marginLeft}px;color:#1a1a1a;font-size:${fontSize}px;line-height:${lineHeight};">`);

  if (isVisible("contact_info") && snapshot.contactInfo?.full_name) {
    parts.push(`<div style="text-align:${textAlign};margin-bottom:${sectionSpacing}px;">`);
    parts.push(`<h1 style="font-family:${headingFontFamily},serif;font-size:${headingFontSize + 6}px;margin:0;font-weight:${headingFontWeight === "bold" ? 700 : headingFontWeight};">${escapeHtml(snapshot.contactInfo.full_name)}</h1>`);
    if (isVisible("preferred_title") && snapshot.profile?.preferred_title) {
      parts.push(`<p style="margin:4px 0 0;font-size:${fontSize + 1}px;">${escapeHtml(snapshot.profile.preferred_title)}</p>`);
    }
    const details = [
      snapshot.contactInfo.email,
      snapshot.contactInfo.phone,
      snapshot.contactInfo.location,
    ].filter(Boolean).map(escapeHtml);
    if (details.length) {
      parts.push(`<p style="margin:4px 0 0;font-size:${fontSize - 1}px;color:#555;">${details.join(" &nbsp;|&nbsp; ")}</p>`);
    }
    parts.push(`</div>`);
  }

  const sectionRenderers: { type: string; render: () => void }[] = [
    {
      type: "professional_summary",
      render: () => {
        if (!snapshot.professionalSummary) return;
        const fw = headingFontWeight === "bold" ? 700 : headingFontWeight;
        parts.push(`<h2 style="font-family:${headingFontFamily},serif;font-size:${headingFontSize}px;font-weight:${fw};text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;padding-bottom:2px;margin:${sectionSpacing}px 0 8px;">Summary</h2>`);
        parts.push(`<p style="margin:0 0 ${sectionSpacing}px;">${escapeHtml(snapshot.professionalSummary)}</p>`);
      },
    },
    {
      type: "skills",
      render: () => {
        if (!snapshot.skills?.length) return;
        const fw = headingFontWeight === "bold" ? 700 : headingFontWeight;
        parts.push(`<h2 style="font-family:${headingFontFamily},serif;font-size:${headingFontSize}px;font-weight:${fw};text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;padding-bottom:2px;margin:${sectionSpacing}px 0 8px;">Skills</h2>`);
        for (const cat of ["proficient", "familiar", "tools"]) {
          const items = snapshot.skills.filter((s: any) => s.category === cat);
          if (!items.length) continue;
          const label = cat === "proficient" ? "Proficient" : cat === "familiar" ? "Familiar" : "Tools";
          parts.push(`<p style="margin:0 0 4px;"><strong>${label}:</strong> ${items.map((s: any) => escapeHtml(s.name)).join(", ")}</p>`);
        }
      },
    },
    {
      type: "work_experience",
      render: () => {
        if (!snapshot.workExperiences?.length) return;
        const fw = headingFontWeight === "bold" ? 700 : headingFontWeight;
        parts.push(`<h2 style="font-family:${headingFontFamily},serif;font-size:${headingFontSize}px;font-weight:${fw};text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;padding-bottom:2px;margin:${sectionSpacing}px 0 8px;">Experience</h2>`);
        for (const w of snapshot.workExperiences) {
          const dates = [w.start_date, w.end_date || (w.is_current ? "Present" : "")].filter(Boolean).join(" — ");
          parts.push(`<div style="margin-bottom:${bulletSpacing}px;">`);
          parts.push(`<p style="margin:0;font-weight:600;">${escapeHtml(w.role)} at ${escapeHtml(w.company)}</p>`);
          if (dates) parts.push(`<p style="margin:0;font-size:${fontSize - 1}px;color:#555;">${escapeHtml(dates)}</p>`);
          if (w.bullets?.length) {
            parts.push(`<ul style="margin:${bulletSpacing}px 0 0;padding-left:18px;">`);
            for (const b of w.bullets) {
              parts.push(`<li style="margin-bottom:2px;">${escapeHtml(b.content)}</li>`);
            }
            parts.push(`</ul>`);
          }
          parts.push(`</div>`);
        }
      },
    },
    {
      type: "education",
      render: () => {
        if (!snapshot.education?.length) return;
        const fw = headingFontWeight === "bold" ? 700 : headingFontWeight;
        parts.push(`<h2 style="font-family:${headingFontFamily},serif;font-size:${headingFontSize}px;font-weight:${fw};text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;padding-bottom:2px;margin:${sectionSpacing}px 0 8px;">Education</h2>`);
        for (const e of snapshot.education) {
          const dates = [e.start_date, e.end_date || (e.is_current ? "Present" : "")].filter(Boolean).join(" — ");
          parts.push(`<p style="margin:0 0 4px;"><strong>${escapeHtml(e.school)}</strong>`);
          if (e.degree) parts.push(` — ${escapeHtml(e.degree)}`);
          if (e.field_of_study) parts.push(` in ${escapeHtml(e.field_of_study)}`);
          if (dates) parts.push(`<br/><span style="color:#555;">${escapeHtml(dates)}</span>`);
          parts.push(`</p>`);
        }
      },
    },
    {
      type: "projects",
      render: () => {
        if (!snapshot.projects?.length) return;
        const fw = headingFontWeight === "bold" ? 700 : headingFontWeight;
        parts.push(`<h2 style="font-family:${headingFontFamily},serif;font-size:${headingFontSize}px;font-weight:${fw};text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;padding-bottom:2px;margin:${sectionSpacing}px 0 8px;">Projects</h2>`);
        for (const p of snapshot.projects) {
          parts.push(`<p style="margin:0 0 2px;"><strong>${escapeHtml(p.name)}</strong>`);
          if (p.description) parts.push(` — ${escapeHtml(p.description)}`);
          parts.push(`</p>`);
        }
      },
    },
    {
      type: "certifications",
      render: () => {
        if (!snapshot.certifications?.length) return;
        const fw = headingFontWeight === "bold" ? 700 : headingFontWeight;
        parts.push(`<h2 style="font-family:${headingFontFamily},serif;font-size:${headingFontSize}px;font-weight:${fw};text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;padding-bottom:2px;margin:${sectionSpacing}px 0 8px;">Certifications</h2>`);
        for (const cert of snapshot.certifications) {
          parts.push(`<p style="margin:0 0 2px;"><strong>${escapeHtml(cert.name)}</strong>`);
          if (cert.issuer) parts.push(` — ${escapeHtml(cert.issuer)}`);
          parts.push(`</p>`);
        }
      },
    },
  ];

  const defaultOrder = sectionRenderers.map(r => r.type);
  const orderedTypes = snapshot.sectionOrder
    ? [...snapshot.sectionOrder]
        .filter((so: any) => so.is_visible !== false)
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
        .map((so: any) => so.section_type)
    : defaultOrder;

  for (const type of orderedTypes) {
    if (type === "contact_info" || type === "preferred_title") continue;
    const renderer = sectionRenderers.find(r => r.type === type);
    if (renderer) renderer.render();
  }

  parts.push(`</div>`);
  return parts.join("\n");
}

function openPrintWindow(title: string, htmlContent: string) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;left:-99999px;top:0;width:0;height:0;border:none;visibility:hidden;";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{size:letter;margin:0;}body{margin:0;}</style></head><body>${htmlContent}</body></html>`);
  doc.close();
  iframe.onload = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
  };
}

function formatCoverLetterHTML(text: string, styling?: any): string {
  const s = styling || {};
  const fontFamily = s.fontFamily || "Georgia";
  const fontSize = s.fontSize || 11;
  const lineHeight = s.lineHeight || 1.6;
  return `<div style="font-family:${fontFamily},serif;max-width:650px;margin:0 auto;padding:40px;color:#1a1a1a;font-size:${fontSize}px;line-height:${lineHeight};white-space:pre-wrap;">${escapeHtml(text).replace(/\n/g, "<br/>")}</div>`;
}

// px → twips (1px at 96dpi ≈ 15.12 twips)
const pxToTwip = (px: number) => Math.round(px * 15.12);
// px → half-points (docx font size unit; 1px ≈ 0.75pt; 1pt = 2 half-pts)
const pxToHalfPt = (px: number) => Math.round(px * 1.5);

function getDocxAlignment(a: string): typeof AlignmentType[keyof typeof AlignmentType] {
  if (a === "center") return AlignmentType.CENTER;
  if (a === "right") return AlignmentType.RIGHT;
  if (a === "justified") return AlignmentType.JUSTIFIED;
  return AlignmentType.LEFT;
}

async function buildResumeDocx(snapshot: any, styling?: any): Promise<Blob> {
  const s = styling || {};
  const fontFamily = s.fontFamily || "Georgia";
  const fontSize = s.fontSize || 11;
  const headingFontFamily = s.headingFontFamily || "Georgia";
  const headingFontSize = s.headingFontSize || 14;
  const headingFontWeight = s.headingFontWeight || "bold";
  const lineHeight = s.lineHeight || 1.4;
  const sectionSpacing = s.sectionSpacing || 12;
  const bulletSpacing = s.bulletSpacing || 4;
  const marginTop = s.marginTop ?? 40;
  const marginBottom = s.marginBottom ?? 40;
  const marginLeft = s.marginLeft ?? 50;
  const marginRight = s.marginRight ?? 50;
  const alignment = s.alignment || "left";

  const align = getDocxAlignment(alignment);
  const bodySize = pxToHalfPt(fontSize);
  const headingSize = pxToHalfPt(headingFontSize);
  const nameSize = pxToHalfPt(headingFontSize + 4);
  const smallSize = pxToHalfPt(fontSize - 1);
  const headingBold = headingFontWeight === "bold" || headingFontWeight === "700";
  const sectionSpacingTwip = pxToTwip(sectionSpacing);
  const bulletSpacingTwip = pxToTwip(bulletSpacing);

  const paragraphs: Paragraph[] = [];

  const sectionHeading = (text: string) => new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: sectionSpacingTwip, after: bulletSpacingTwip },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "333333", space: 2 } },
    children: [new TextRun({ text: text.toUpperCase(), font: headingFontFamily, size: headingSize, bold: headingBold, characterSpacing: 10 })],
  });

  const bodyPara = (text: string, opts?: { bold?: boolean; italic?: boolean; size?: number; spacingAfter?: number }) =>
    new Paragraph({
      alignment: align,
      spacing: { after: opts?.spacingAfter ?? bulletSpacingTwip },
      children: [new TextRun({ text, font: fontFamily, size: opts?.size ?? bodySize, bold: opts?.bold, italics: opts?.italic })],
    });

  function fmtDate(d: string | null | undefined): string {
    if (!d) return "";
    try {
      const dt = new Date(d);
      return dt.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    } catch { return d; }
  }

  function isVisible(type: string): boolean {
    if (!snapshot.sectionOrder) return true;
    const entry = snapshot.sectionOrder.find((so: any) => so.section_type === type);
    return entry?.is_visible ?? true;
  }

  const defaultOrder = ["professional_summary", "skills", "work_experience", "education", "projects", "certifications"];
  const orderedTypes: string[] = snapshot.sectionOrder
    ? [...snapshot.sectionOrder]
        .filter((so: any) => so.is_visible !== false)
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
        .map((so: any) => so.section_type)
    : defaultOrder;

  // Contact info header (always first)
  if (isVisible("contact_info") && snapshot.contactInfo?.full_name) {
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: pxToTwip(2) },
      children: [new TextRun({ text: snapshot.contactInfo.full_name, font: headingFontFamily, size: nameSize, bold: true })],
    }));
    if (isVisible("preferred_title") && snapshot.profile?.preferred_title) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: pxToTwip(2) },
        children: [new TextRun({ text: snapshot.profile.preferred_title, font: fontFamily, size: pxToHalfPt(fontSize + 1) })],
      }));
    }
    const details = [snapshot.contactInfo.email, snapshot.contactInfo.phone, snapshot.contactInfo.location, snapshot.contactInfo.linkedin_url].filter(Boolean) as string[];
    if (details.length) paragraphs.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: sectionSpacingTwip },
      children: [new TextRun({ text: details.join("  |  "), font: fontFamily, size: smallSize })],
    }));
  }

  for (const type of orderedTypes) {
    if (type === "contact_info" || type === "preferred_title") continue;
    switch (type) {
      case "professional_summary":
        if (snapshot.professionalSummary) {
          paragraphs.push(sectionHeading("Summary"));
          paragraphs.push(bodyPara(snapshot.professionalSummary));
        }
        break;
      case "skills":
        if (snapshot.skills?.length) {
          paragraphs.push(sectionHeading("Skills"));
          for (const cat of ["proficient", "familiar", "tools"]) {
            const items = snapshot.skills.filter((sk: any) => sk.category === cat);
            if (!items.length) continue;
            const label = cat === "proficient" ? "Proficient" : cat === "familiar" ? "Familiar" : "Tools";
            paragraphs.push(new Paragraph({
              alignment: align,
              spacing: { after: bulletSpacingTwip },
              children: [
                new TextRun({ text: `${label}: `, font: fontFamily, size: bodySize, bold: true }),
                new TextRun({ text: items.map((sk: any) => sk.name).join(", "), font: fontFamily, size: bodySize }),
              ],
            }));
          }
        }
        break;
      case "work_experience":
        if (snapshot.workExperiences?.length) {
          paragraphs.push(sectionHeading("Experience"));
          for (const w of snapshot.workExperiences) {
            const dateStr = `${fmtDate(w.start_date)} – ${w.is_current ? "Present" : fmtDate(w.end_date)}`;
            paragraphs.push(new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { after: pxToTwip(2) },
              children: [
                new TextRun({ text: w.role ?? "", font: fontFamily, size: bodySize, bold: true }),
                new TextRun({ text: `\t${dateStr}`, font: fontFamily, size: smallSize }),
              ],
            }));
            paragraphs.push(bodyPara(`${w.company ?? ""}`, { italic: true, spacingAfter: bulletSpacingTwip }));
            for (const b of w.bullets ?? []) paragraphs.push(new Paragraph({
              alignment: align,
              bullet: { level: 0 },
              spacing: { after: pxToTwip(bulletSpacing / 2) },
              children: [new TextRun({ text: b.content, font: fontFamily, size: bodySize })],
            }));
          }
        }
        break;
      case "education":
        if (snapshot.education?.length) {
          paragraphs.push(sectionHeading("Education"));
          for (const e of snapshot.education) {
            const dateStr = `${fmtDate(e.start_date)}${e.end_date ? ` – ${fmtDate(e.end_date)}` : e.is_current ? " – Present" : ""}`;
            paragraphs.push(new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { after: pxToTwip(2) },
              children: [
                new TextRun({ text: e.school ?? "", font: fontFamily, size: bodySize, bold: true }),
                ...(dateStr ? [new TextRun({ text: `\t${dateStr}`, font: fontFamily, size: smallSize })] : []),
              ],
            }));
            const degreeField = [e.degree, e.field_of_study].filter(Boolean).join(", ");
            if (degreeField) paragraphs.push(bodyPara(degreeField, { spacingAfter: bulletSpacingTwip }));
          }
        }
        break;
      case "projects":
        if (snapshot.projects?.length) {
          paragraphs.push(sectionHeading("Projects"));
          for (const p of snapshot.projects) {
            paragraphs.push(new Paragraph({
              alignment: align,
              spacing: { after: pxToTwip(2) },
              children: [new TextRun({ text: `${p.name}${p.url ? ` — ${p.url}` : ""}`, font: fontFamily, size: bodySize, bold: true })],
            }));
            if (p.description) paragraphs.push(bodyPara(p.description, { spacingAfter: bulletSpacingTwip }));
          }
        }
        break;
      case "certifications":
        if (snapshot.certifications?.length) {
          paragraphs.push(sectionHeading("Certifications"));
          for (const cert of snapshot.certifications) {
            paragraphs.push(new Paragraph({
              alignment: align,
              spacing: { after: bulletSpacingTwip },
              children: [
                new TextRun({ text: cert.name, font: fontFamily, size: bodySize, bold: true }),
                ...(cert.issuer ? [new TextRun({ text: ` — ${cert.issuer}`, font: fontFamily, size: bodySize })] : []),
              ],
            }));
          }
        }
        break;
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: pxToTwip(marginTop), bottom: pxToTwip(marginBottom), left: pxToTwip(marginLeft), right: pxToTwip(marginRight) },
        },
      },
      children: paragraphs,
    }],
  });

  return Packer.toBlob(doc);
}

async function buildCoverLetterDocx(text: string, styling?: any): Promise<Blob> {
  const s = styling || {};
  const fontFamily = s.fontFamily || "Georgia";
  const fontSize = s.fontSize || 11;
  const marginTop = s.marginTop ?? 40;
  const marginBottom = s.marginBottom ?? 40;
  const marginLeft = s.marginLeft ?? 50;
  const marginRight = s.marginRight ?? 50;

  const paragraphs = text.split("\n").map(line => new Paragraph({
    children: [new TextRun({ text: line, font: fontFamily, size: pxToHalfPt(fontSize) })],
    spacing: { after: 160 },
  }));

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: pxToTwip(marginTop), bottom: pxToTwip(marginBottom), left: pxToTwip(marginLeft), right: pxToTwip(marginRight) },
        },
      },
      children: paragraphs,
    }],
  });

  return Packer.toBlob(doc);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [state, setState] = useState<State>({ phase: "checking-auth" });
  const [profileName, setProfileName] = useState<string | null>(null);
  const [coverLetterExpanded, setCoverLetterExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const runExtract = async (url: string, text: string) => {
      if (cancelled) return;
      setState({ phase: "extracting" });
      try {
        const job = await extractJobDetails(url, text);
        if (!cancelled) setState({ phase: "preview", job, pageUrl: url });
      } catch (e: any) {
        if (!cancelled) {
          const statusCode = e instanceof AuthFetchError ? e.statusCode : undefined;
          const msg = e.message || "Failed to extract job details";
          const isRetryable = !statusCode || statusCode >= 500;
          setState({ phase: "error", message: msg, statusCode, retry: isRetryable ? () => runExtract(url, text) : undefined });
        }
      }
    };

    const run = async () => {
      const token = await getAccessToken();
      if (!token) {
        if (!cancelled) setState({ phase: "no-auth" });
        return;
      }

      getUserDisplayName().then(name => {
        if (name && !cancelled) setProfileName(name);
      });

      if (!cancelled) setState({ phase: "checking-page" });

      try {
        const { url, text } = await getPageContent();

        if (!isJobPage(url, text)) {
          if (!cancelled) setState({ phase: "not-job-page", url, text });
          return;
        }

        await runExtract(url, text);
      } catch (e: any) {
        if (!cancelled) {
          const statusCode = e instanceof AuthFetchError ? e.statusCode : undefined;
          const msg = e.message || "Failed to extract job details";
          setState({ phase: "error", message: msg, statusCode });
        }
      }
    };

    run();

    return () => { cancelled = true; };
  }, []);

  const runForceExtract = async (url: string, text: string) => {
    setState({ phase: "extracting" });
    try {
      const job = await extractJobDetails(url, text);
      setState({ phase: "preview", job, pageUrl: url });
    } catch (e: any) {
      const statusCode = e instanceof AuthFetchError ? e.statusCode : undefined;
      const msg = e.message || "Failed to extract job details";
      const isRetryable = !statusCode || statusCode >= 500;
      setState({ phase: "error", message: msg, statusCode, retry: isRetryable ? () => runForceExtract(url, text) : undefined });
    }
  };

  const handleForceExtract = () => {
    if (state.phase !== "not-job-page") return;
    runForceExtract(state.url, state.text);
  };

  const runSaveAndGenerate = async (job: ExtractedJob, pageUrl: string) => {
    setState({ phase: "saving" });
    try {
      const descParts = [
        `Key Responsibilities: ${job.key_responsibilities.join(", ")}`,
        `Required Skills: ${job.required_skills.join(", ")}`,
        `Years of Experience Required: ${job.years_of_experience_required}`,
      ];
      if (job.company_description) {
        descParts.push(`Company Description: ${job.company_description}`);
      }
      if (job.nice_to_have_skills?.length) {
        descParts.push(`Nice-to-Have Skills: ${job.nice_to_have_skills.join(", ")}`);
      }

      const jobId = await saveJob({
        title: job.job_title,
        company: job.company,
        job_link: pageUrl,
        job_description: descParts.join("\n\n"),
        status: "draft",
      });

      setState({ phase: "generating" });

      const docs = await generateDocuments(jobId);

      setState({
        phase: "done",
        contentSnapshot: docs?.cv?.contentSnapshot ?? null,
        stylingSnapshot: docs?.cv?.stylingSnapshot ?? null,
        coverLetter: docs?.coverLetter,
        jobUrl: jobId,
        title: job.job_title,
        company: job.company,
      });
    } catch (e: any) {
      if (e.message === "subscription_required") {
        setState({ phase: "error", message: "Your trial has ended. Subscribe to generate documents." });
      } else {
        const statusCode = e instanceof AuthFetchError ? e.statusCode : undefined;
        const msg = e.message || "Something went wrong";
        const isRetryable = !statusCode || statusCode >= 500;
        setState({ phase: "error", message: msg, statusCode, retry: isRetryable ? () => runSaveAndGenerate(job, pageUrl) : undefined });
      }
    }
  };

  const handleSaveAndGenerate = () => {
    if (state.phase !== "preview") return;
    runSaveAndGenerate(state.job, state.pageUrl);
  };

  const openResumePrint = () => {
    if (state.phase !== "done" || !state.contentSnapshot) return;
    const html = renderResumeHTML(state.contentSnapshot, state.stylingSnapshot);
    openPrintWindow(`Resume - ${state.title} at ${state.company}`, html);
  };

  const downloadResumeDocx = async () => {
    if (state.phase !== "done" || !state.contentSnapshot) return;
    const blob = await buildResumeDocx(state.contentSnapshot, state.stylingSnapshot);
    downloadBlob(blob, `Resume_${(state.title ?? "").replace(/\s+/g, "_")}_at_${(state.company ?? "").replace(/\s+/g, "_")}.docx`);
  };

  const openCoverLetterPrint = () => {
    if (state.phase !== "done" || !state.coverLetter) return;
    const html = formatCoverLetterHTML(state.coverLetter, state.stylingSnapshot);
    openPrintWindow(`Cover Letter - ${state.title} at ${state.company}`, html);
  };

  const downloadCoverLetterDocx = async () => {
    if (state.phase !== "done" || !state.coverLetter) return;
    const blob = await buildCoverLetterDocx(state.coverLetter, state.stylingSnapshot);
    downloadBlob(blob, `Cover_Letter_${(state.title ?? "").replace(/\s+/g, "_")}_at_${(state.company ?? "").replace(/\s+/g, "_")}.docx`);
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
        {profileName && (
          <div className="header-right">
            <div className="profile-badge">
              <div className="profile-avatar">{getInitials(profileName)}</div>
              <span className="profile-name">{profileName}</span>
            </div>
          </div>
        )}
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
              <div className="btn-group">
                <button className="btn btn-secondary" onClick={openResumePrint}>
                  PDF
                </button>
                <button className="btn btn-secondary" onClick={() => void downloadResumeDocx()}>
                  Word
                </button>
              </div>
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
                    PDF
                  </button>
                  <button className="btn btn-secondary" onClick={() => void downloadCoverLetterDocx()}>
                    Word
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
            {state.statusCode && state.statusCode >= 500 && (
              <div className="error-badge error-badge-5xx">Server Error</div>
            )}
            {state.statusCode && state.statusCode >= 400 && state.statusCode < 500 && state.statusCode !== 402 && (
              <div className="error-badge error-badge-4xx">Client Error</div>
            )}
            <p className="title">Something went wrong</p>
            <p className="desc">{state.message}</p>
            {state.retry ? (
              <div className="btn-group" style={{ marginTop: 4 }}>
                <button className="btn btn-danger" onClick={state.retry}>Retry</button>
                <button className="btn btn-secondary" onClick={() => window.close()}>Close</button>
              </div>
            ) : (
              <button className="btn btn-primary full" onClick={() => window.close()}>
                Close
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
