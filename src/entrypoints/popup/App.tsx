import React, { useState, useEffect, createElement } from "react";
import { Document as PdfDocument, Page, View, Text } from "@react-pdf/renderer";
import { pdf } from "@react-pdf/renderer";
import { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, TabStopType } from "docx";
import { format } from "date-fns";
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

const PROWRITE_APP_URL = import.meta.env.VITE_APP_URL as string;
const EXTENSION_ID = import.meta.env.VITE_EXTENSION_ID as string;

function openProWrite(path: string) {
  // If opening the auth page, include the extension ID as a query param
  // so the auth flow can redirect to /bridge instead of /dashboard after login
  const url = path === "/auth" 
    ? `${PROWRITE_APP_URL}${path}?ext=${EXTENSION_ID}`
    : `${PROWRITE_APP_URL}${path}`;
  chrome.tabs.create({ url });
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
      parts.push(`<p style="margin:4px 0 0;font-size:${fontSize - 1}px;color:#555;">${details.join(" • ")}</p>`);
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
           const dates = `${w.start_date ? new Date(w.start_date).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""} – ${w.is_current ? "Present" : w.end_date ? new Date(w.end_date).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""}`.replace(/^ – /, "").replace(/ – $/, "");
           parts.push(`<div style="margin-bottom:${bulletSpacing}px;">`);
           parts.push(`<div style="display:flex;justify-content:space-between;"><p style="margin:0;font-weight:600;">${escapeHtml(w.role)}</p><p style="margin:0;font-size:${fontSize - 1}px;color:#555;">${escapeHtml(dates)}</p></div>`);
           parts.push(`<p style="margin:0;font-style:italic;">${escapeHtml(w.company)}</p>`);
           if (w.bullets?.length) {
             parts.push(`<ul style="margin:${bulletSpacing}px 0 0;padding-left:0;list-style-type:disc;list-style-position:outside;margin-left:16px;">`);
             for (const b of w.bullets) {
               parts.push(`<li style="margin-bottom:${bulletSpacing / 2}px;">${escapeHtml(b.content)}</li>`);
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
           const dateStr = `${e.start_date ? new Date(e.start_date).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""}${e.end_date ? ` – ${new Date(e.end_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : e.is_current ? " – Present" : ""}`.trim();
           parts.push(`<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><div><p style="margin:0 0 4px;"><strong>${escapeHtml(e.school)}</strong>`);
           if (e.degree) parts.push(` — ${escapeHtml(e.degree)}`);
           if (e.field_of_study) parts.push(` in ${escapeHtml(e.field_of_study)}`);
           parts.push(`</p></div><p style="margin:0;font-size:${fontSize - 1}px;color:#555;white-space:nowrap;margin-left:8px;">${escapeHtml(dateStr)}</p></div>`);
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

// Export resume as PDF blob using react-pdf
async function exportResumePdf(snapshot: any, styling?: any): Promise<Blob> {
  try {
    const blob = await pdf(
      createElement(ResumePdfDocument, { data: snapshot, styling: styling || {} })
    ).toBlob();
    return blob;
  } catch (err) {
    console.error("PDF export failed:", err);
    throw err;
  }
}

// Download resume PDF directly
async function downloadResumePdf(filename: string, snapshot: any, styling?: any) {
  try {
    const blob = await exportResumePdf(snapshot, styling);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Error downloading PDF:", err);
  }
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

// Page size constants (in twips)
// LETTER: 8.5in × 11in (12240 × 15840 twips)
// A4: 210mm × 297mm (11906 × 16838 twips)
const PAGE_WIDTHS = {
  LETTER: 12240,
  A4: 11906,
} as const;

const PAGE_HEIGHTS = {
  LETTER: 15840,
  A4: 16838,
} as const;

function getDocxAlignment(a: string): typeof AlignmentType[keyof typeof AlignmentType] {
  if (a === "center") return AlignmentType.CENTER;
  if (a === "right") return AlignmentType.RIGHT;
  if (a === "justified") return AlignmentType.JUSTIFIED;
  return AlignmentType.LEFT;
}

// PDF Document Component (matches prowrite-lovable)
function ResumePdfDocument({ data, styling }: any) {
  const defaultStyling = {
    fontFamily: "Times-Roman",
    fontSize: 11,
    headingFontFamily: "Times-Roman",
    headingFontSize: 14,
    headingFontWeight: "bold",
    lineHeight: 1.4,
    sectionSpacing: 12,
    bulletSpacing: 4,
    marginTop: 40,
    marginBottom: 40,
    marginLeft: 50,
    marginRight: 50,
    alignment: "left",
  };
  
  const c = { ...defaultStyling, ...(styling || {}) };
  const { contactInfo, profile, workExperiences, skills, education, projects, certifications, sectionOrder } = data;
  
  // Normalise professionalSummary (string) to summaries (array of objects) for consistency
  const summaries = data.summaries
    ?? (data.professionalSummary
        ? [{ id: "summary", content: data.professionalSummary }]
        : []);

  // Compute visible sections based on sectionOrder or fallback to default
  const visibleSections = sectionOrder?.length > 0
    ? sectionOrder.filter((sec: any) => sec.is_visible).map((sec: any) => sec.section_type)
    : ["contact_info", "preferred_title", "professional_summary", "skills", "work_experience", "projects", "certifications", "education"];

  const fontFamily = c.fontFamily?.toLowerCase().includes("georgia") || c.fontFamily?.toLowerCase().includes("serif")
    ? "Times-Roman"
    : c.fontFamily?.toLowerCase().includes("arial") || c.fontFamily?.toLowerCase().includes("helvetica") || c.fontFamily?.toLowerCase().includes("sans")
      ? "Helvetica"
      : "Times-Roman";

  const headingFontFamily = c.headingFontFamily?.toLowerCase().includes("georgia") || c.headingFontFamily?.toLowerCase().includes("serif")
    ? "Times-Roman"
    : c.headingFontFamily?.toLowerCase().includes("arial") || c.headingFontFamily?.toLowerCase().includes("helvetica") || c.headingFontFamily?.toLowerCase().includes("sans")
      ? "Helvetica"
      : "Times-Roman";

  const headingStyle = {
    fontFamily: headingFontFamily,
    fontSize: c.headingFontSize || 14,
    fontWeight: (c.headingFontWeight === "bold" ? "bold" : "normal") as const,
    borderBottomWidth: 1,
    borderBottomColor: "#333333",
    paddingBottom: 2,
    marginBottom: c.bulletSpacing || 4,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  };

  const textAlign = (c.alignment === "center" ? "center" : c.alignment === "right" ? "right" : "left") as const;

  const fmtDate = (d: string | null | undefined) => {
    if (!d) return "";
    try {
      return format(new Date(d), "MMM yyyy");
    } catch {
      return d || "";
    }
  };

  // Map section types to render functions
  const sectionRenderers: Record<string, () => React.ReactNode> = {
    contact_info: () => contactInfo?.full_name ? (
      <View style={{ textAlign: "center", marginBottom: c.sectionSpacing || 12 }}>
        <Text style={{ fontSize: (c.headingFontSize || 14) + 4, fontWeight: "bold", fontFamily: headingFontFamily, lineHeight: 1, marginBottom: 0 }}>
          {contactInfo.full_name}
        </Text>
        {profile?.preferred_title && (
          <Text style={{ fontSize: (c.fontSize || 11) + 1, marginTop: 2, lineHeight: 1 }}>
            {profile.preferred_title}
          </Text>
        )}
        <View style={{ fontSize: c.fontSize - 1, marginTop: 4, display: "flex", flexDirection: "row", justifyContent: "center", flexWrap: "wrap" }}>
          {(() => {
            const fields = [contactInfo.email, contactInfo.phone, contactInfo.location, contactInfo.linkedin_url, contactInfo.github_url, contactInfo.portfolio_url].filter(Boolean);
            return fields.map((item, idx) => (
              <React.Fragment key={idx}>
                <Text style={{ color: "#000000" }}>{item}</Text>
                {idx < fields.length - 1 && (
                  <Text style={{ paddingLeft: 6, paddingRight: 6 }}>•</Text>
                )}
              </React.Fragment>
            ));
          })()}
        </View>
      </View>
    ) : null,

    preferred_title: () => null,

    professional_summary: () => summaries?.length > 0 ? (
      <View style={{ marginBottom: c.sectionSpacing || 12 }}>
        <Text style={headingStyle}>Summary</Text>
        {summaries.map((s: any) => (
          <Text key={s.id} style={{ marginBottom: c.bulletSpacing || 4, fontFamily }}>
            {s.content}
          </Text>
        ))}
      </View>
    ) : null,

    skills: () => skills?.length > 0 ? (
      <View style={{ marginBottom: c.sectionSpacing || 12 }}>
        <Text style={headingStyle}>Skills</Text>
        {["proficient", "familiar", "tools"].map((cat) => {
          const items = skills.filter((sk: any) => sk.category === cat);
          if (items.length === 0) return null;
          const label = cat === "proficient" ? "Proficient" : cat === "familiar" ? "Familiar" : "Tools";
          return (
            <Text key={cat} style={{ marginBottom: c.bulletSpacing || 4, fontFamily }}>
              <Text style={{ fontWeight: "bold" }}>{label}:</Text> {items.map((sk: any) => sk.name).join(", ")}
            </Text>
          );
        })}
      </View>
    ) : null,

    work_experience: () => workExperiences?.length > 0 ? (
      <View style={{ marginBottom: c.sectionSpacing || 12 }}>
        <Text style={headingStyle}>Experience</Text>
        {workExperiences.map((w: any) => (
          <View key={w.id} style={{ marginBottom: (c.sectionSpacing || 12) - 4 }}>
            <View style={{ display: "flex", flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontWeight: "bold", fontFamily }}>
                {w.role}
              </Text>
              <Text style={{ fontSize: (c.fontSize || 11) - 1, fontFamily }}>
                {fmtDate(w.start_date)} – {w.is_current ? "Present" : fmtDate(w.end_date)}
              </Text>
            </View>
            <Text style={{ fontStyle: "italic", fontFamily }}>
              {w.company}
            </Text>
            {w.bullets?.length > 0 && (
              <View style={{ marginTop: c.bulletSpacing || 4 }}>
                {w.bullets.map((b: any) => (
                  <View key={b.id} style={{ display: "flex", flexDirection: "row", marginBottom: (c.bulletSpacing || 4) / 4, marginLeft: 4 }}>
                    <Text style={{ fontFamily }}>•</Text>
                    <Text style={{ fontFamily, marginLeft: 8 }}>
                      {b.content}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ))}
      </View>
    ) : null,

    projects: () => projects?.length > 0 ? (
      <View style={{ marginBottom: c.sectionSpacing || 12 }}>
        <Text style={headingStyle}>Projects</Text>
        {projects.map((p: any) => (
          <View key={p.id} style={{ marginBottom: c.bulletSpacing || 4 }}>
            <View style={{ display: "flex", flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontWeight: "bold", fontFamily }}>
                {p.name}{p.url ? ` — ${p.url}` : ""}
              </Text>
              {(p.start_date || p.end_date) && (
                <Text style={{ fontSize: c.fontSize - 1, fontFamily }}>
                  {fmtDate(p.start_date)}{p.end_date ? ` – ${fmtDate(p.end_date)}` : ""}
                </Text>
              )}
            </View>
            {p.description && (
              <Text style={{ marginTop: 2, fontFamily }}>
                {p.description}
              </Text>
            )}
          </View>
        ))}
      </View>
    ) : null,

    certifications: () => certifications?.length > 0 ? (
      <View style={{ marginBottom: c.sectionSpacing || 12 }}>
        <Text style={headingStyle}>Certifications</Text>
        {certifications.map((cert: any) => (
          <Text key={cert.id} style={{ marginBottom: c.bulletSpacing || 4, fontFamily }}>
            <Text style={{ fontWeight: "bold" }}>{cert.name}</Text>
            {cert.issuer ? ` — ${cert.issuer}` : ""}
            {cert.issue_date ? ` (${fmtDate(cert.issue_date)})` : ""}
          </Text>
        ))}
      </View>
    ) : null,

    education: () => education?.length > 0 ? (
      <View style={{ marginBottom: c.sectionSpacing || 12 }}>
        <Text style={headingStyle}>Education</Text>
        {education.map((e: any) => (
          <View key={e.id} style={{ marginBottom: c.bulletSpacing || 4 }}>
            <View style={{ display: "flex", flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontWeight: "bold", fontFamily }}>
                {e.school}
              </Text>
              <Text style={{ fontSize: (c.fontSize || 11) - 1, fontFamily }}>
                {fmtDate(e.start_date)}{e.end_date ? ` – ${fmtDate(e.end_date)}` : e.is_current ? " – Present" : ""}
              </Text>
            </View>
            {(e.degree || e.field_of_study) && (
              <Text style={{ fontFamily }}>
                {[e.degree, e.field_of_study].filter(Boolean).join(", ")}
              </Text>
            )}
          </View>
        ))}
      </View>
    ) : null,
  };

  return (
    <PdfDocument>
      <Page
        size="LETTER"
        style={{
          paddingTop: c.marginTop || 40,
          paddingBottom: c.marginBottom || 40,
          paddingLeft: c.marginLeft || 50,
          paddingRight: c.marginRight || 50,
          fontFamily,
          fontSize: c.fontSize || 11,
          lineHeight: c.lineHeight || 1.4,
          textAlign,
        }}
      >
        {visibleSections.map((type: string) => {
          const render = sectionRenderers[type];
          return render ? <View key={type}>{render()}</View> : null;
        })}
      </Page>
    </PdfDocument>
  );
}

async function buildResumeDocx(snapshot: any, styling?: any, pageSize: "LETTER" | "A4" = "LETTER"): Promise<Blob> {
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

  // Compute page dimensions and text width for tab stop positioning
  const pageWidthTwips = PAGE_WIDTHS[pageSize];
  const pageHeightTwips = PAGE_HEIGHTS[pageSize];
  const textWidthTwips = pageWidthTwips - pxToTwip(marginLeft) - pxToTwip(marginRight);

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
    const details = [snapshot.contactInfo.email, snapshot.contactInfo.phone, snapshot.contactInfo.location, snapshot.contactInfo.linkedin_url, snapshot.contactInfo.github_url, snapshot.contactInfo.portfolio_url].filter(Boolean) as string[];
    if (details.length) paragraphs.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: sectionSpacingTwip },
      children: details.flatMap((item, idx) => [
        new TextRun({ text: item, font: fontFamily, size: smallSize }),
        ...(idx < details.length - 1
          ? [new TextRun({ text: "   •   ", font: fontFamily, size: smallSize })]
          : []),
      ]),
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
               tabStops: [{ type: TabStopType.RIGHT, position: textWidthTwips }],
               children: [
                 new TextRun({ text: w.role ?? "", font: fontFamily, size: bodySize, bold: true }),
                 new TextRun({ text: `\t${dateStr}`, font: fontFamily, size: smallSize }),
               ],
             }));
            paragraphs.push(bodyPara(`${w.company ?? ""}`, { italic: true, spacingAfter: bulletSpacingTwip }));
            for (const b of w.bullets ?? []) paragraphs.push(new Paragraph({
              alignment: align,
              spacing: { after: pxToTwip(bulletSpacing / 2) },
              indent: { left: 181, hanging: 120 },
              children: [
                new TextRun({ text: "•\t", font: fontFamily, size: bodySize }),
                new TextRun({ text: b.content, font: fontFamily, size: bodySize }),
              ],
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
               tabStops: [{ type: TabStopType.RIGHT, position: textWidthTwips }],
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
           size: { width: pageWidthTwips, height: pageHeightTwips },
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
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let storageListenerUnsubscribe: (() => void) | null = null;

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

    const STORAGE_KEY = import.meta.env.VITE_SUPABASE_STORAGE_KEY as string;

    const waitForSession = (timeoutMs: number): Promise<boolean> => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), timeoutMs);
        const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
          if (STORAGE_KEY in changes) {
            clearTimeout(timeout);
            chrome.storage.onChanged.removeListener(listener);
            resolve(true);
          }
        };
        chrome.storage.onChanged.addListener(listener);
      });
    };

    const run = async () => {
      // Step 1: Check local storage (fast path)
      let token = await getAccessToken();
      if (token) {
        if (!cancelled) {
          getUserDisplayName().then(name => {
            if (name && !cancelled) setProfileName(name);
          });
          setState({ phase: "checking-page" });
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
        }
        return;
      }

      // Step 2: Try to sync auth from any open prowrite.app tab
      try {
        await chrome.runtime.sendMessage({ type: "sync-auth-from-tab" });
        await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for content script to fire
        token = await getAccessToken();
        if (token) {
          if (!cancelled) {
            getUserDisplayName().then(name => {
              if (name && !cancelled) setProfileName(name);
            });
            setState({ phase: "checking-page" });
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
          }
          return;
        }
      } catch {
        // No open tab or error communicating with background
      }

      // Step 3: Open prowrite.app /bridge as background tab
      // Use storage.onChanged to detect when the session appears (content script fires)
      // instead of relying on a fixed timeout
      let backgroundTabId: number | null = null;
      try {
        const response = await chrome.runtime.sendMessage({
          type: "open-prowrite-background-tab",
          url: import.meta.env.VITE_APP_URL as string,
          extensionId: EXTENSION_ID,
        });
        backgroundTabId = response?.tabId || null;

        if (backgroundTabId) {
          // Wait for the session to appear in storage or timeout after 5s
          const sessionAppeared = await new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => resolve(false), 5000);
            const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
              if (STORAGE_KEY in changes && changes[STORAGE_KEY].newValue) {
                clearTimeout(timeout);
                chrome.storage.onChanged.removeListener(listener);
                resolve(true);
              }
            };
            chrome.storage.onChanged.addListener(listener);
          });

          // Always close the background tab regardless of outcome
          try {
            await chrome.runtime.sendMessage({ type: "close-tab", tabId: backgroundTabId });
          } catch {
            // Ignore errors closing the tab
          }

          if (sessionAppeared) {
            token = await getAccessToken();
            if (token) {
              if (!cancelled) {
                getUserDisplayName().then(name => {
                  if (name && !cancelled) setProfileName(name);
                });
                setState({ phase: "checking-page" });
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
              }
              return;
            }
          }
        }
      } catch {
        // Error opening background tab
        if (backgroundTabId) {
          try {
            await chrome.runtime.sendMessage({ type: "close-tab", tabId: backgroundTabId });
          } catch {
            // Ignore errors closing the tab
          }
        }
      }

      // Step 4: No session found — show login screen and listen for storage changes
      if (!cancelled) {
        setState({ phase: "no-auth" });

        // Register listener for storage changes
        const STORAGE_KEY = import.meta.env.VITE_SUPABASE_STORAGE_KEY as string;
        const storageListener = (changes: Record<string, chrome.storage.StorageChange>) => {
          if (STORAGE_KEY in changes && changes[STORAGE_KEY].newValue) {
            // Session appeared in storage — automatically proceed
            if (storageListenerUnsubscribe) {
              storageListenerUnsubscribe();
              storageListenerUnsubscribe = null;
            }
            if (!cancelled) {
              run(); // Recursively call run() to proceed with extraction
            }
          }
        };

        chrome.storage.onChanged.addListener(storageListener);
        storageListenerUnsubscribe = () => {
          chrome.storage.onChanged.removeListener(storageListener);
        };
      }
    };

    run();

    return () => {
      cancelled = true;
      if (storageListenerUnsubscribe) {
        storageListenerUnsubscribe();
      }
    };
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

  const runGenerateDocuments = async (job: ExtractedJob, jobId: string) => {
    setState({ phase: "generating" });
    try {
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
        const isRetryable = !statusCode || statusCode >= 500 || statusCode === 429;
        setState({ phase: "error", message: msg, statusCode, retry: isRetryable ? () => runGenerateDocuments(job, jobId) : undefined });
      }
    }
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

      await runGenerateDocuments(job, jobId);
    } catch (e: any) {
      const statusCode = e instanceof AuthFetchError ? e.statusCode : undefined;
      const msg = e.message || "Something went wrong";
      const isRetryable = !statusCode || statusCode >= 500;
      setState({ phase: "error", message: msg, statusCode, retry: isRetryable ? () => runSaveAndGenerate(job, pageUrl) : undefined });
    }
  };

  const handleSaveAndGenerate = () => {
    if (state.phase !== "preview") return;
    runSaveAndGenerate(state.job, state.pageUrl);
  };

  const downloadResumePdfFile = async () => {
    if (state.phase !== "done" || !state.contentSnapshot) return;
    setDownloadError(null);
    try {
      const filename = `CV_${(state.company ?? "").replace(/\s+/g, "_")}_${(state.title ?? "").replace(/\s+/g, "_")}.pdf`;
      await downloadResumePdf(filename, state.contentSnapshot, state.stylingSnapshot);
    } catch (err: any) {
      const msg = err?.message || "Failed to download PDF. Please try again.";
      setDownloadError(msg);
      console.error("Resume PDF download error:", err);
    }
  };

  const downloadResumeDocx = async () => {
    if (state.phase !== "done" || !state.contentSnapshot) return;
    setDownloadError(null);
    try {
      const blob = await buildResumeDocx(state.contentSnapshot, state.stylingSnapshot);
      const filename = `CV_${(state.company ?? "").replace(/\s+/g, "_")}_${(state.title ?? "").replace(/\s+/g, "_")}.docx`;
      downloadBlob(blob, filename);
    } catch (err: any) {
      const msg = err?.message || "Failed to download Word document. Please try again.";
      setDownloadError(msg);
      console.error("Resume DOCX download error:", err);
    }
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

             {downloadError && (
               <div style={{
                 backgroundColor: "#fee2e2",
                 border: "1px solid #fecaca",
                 borderRadius: "6px",
                 padding: "12px",
                 marginBottom: "16px",
                 display: "flex",
                 justifyContent: "space-between",
                 alignItems: "center",
               }}>
                 <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                   <span style={{ fontSize: "16px" }}>⚠️</span>
                   <p style={{ margin: 0, color: "#991b1b", fontSize: "13px" }}>{downloadError}</p>
                 </div>
                 <button
                   onClick={() => setDownloadError(null)}
                   style={{
                     background: "none",
                     border: "none",
                     cursor: "pointer",
                     color: "#991b1b",
                     fontSize: "18px",
                     padding: "0 4px",
                   }}
                 >
                   ✕
                 </button>
               </div>
             )}

             <div className="doc-section">
              <div className="doc-section-header">
                <span className="doc-icon">📄</span>
                <span>CV / Resume</span>
              </div>
               <div className="btn-group">
                 <button className="btn btn-secondary" onClick={() => void downloadResumePdfFile()}>
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
