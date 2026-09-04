import { CutButton } from "@/components/sarvathra/cut-button";
import { Logo } from "@/components/sarvathra/logo";
import type { CSSProperties, ReactNode } from "react";

type FooterLink = { label: string; href: string };

/**
 * Only destinations that exist.
 *
 * The template's footer named Pricing, Customers, Integrations, Documentation,
 * Developers, Changelog and System Status — every one of them a link to a page
 * a template does not have. A footer full of dead anchors is the same fault as
 * a logo wall of customers we do not have: it looks like a bigger company and
 * fails the moment anybody clicks.
 */
const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Platform",
    links: [
      { label: "Care pathways", href: "#pathways" },
      { label: "The call", href: "#the-call" },
      { label: "Escalation", href: "#escalation" },
      { label: "Your records", href: "#records" },
    ],
  },
  {
    title: "Answers",
    links: [
      { label: "Questions", href: "#faq" },
      { label: "Hear it answer", href: "tel:+918040802529" },
    ],
  },
];

/**
 * Empty on purpose.
 *
 * The template linked GitHub, LinkedIn, X and YouTube. Sarvathra has no
 * accounts on any of them, and four icons pointing at `#github` are worse than
 * none — the row renders nothing while the array is empty, so adding a real
 * account later is one line here.
 */
const SOCIALS: { label: string; href: string; icon: ReactNode }[] = [];

const PANEL_CLIP =
  "polygon(28px 0, 100% 0, 100% calc(100% - 28px), calc(100% - 28px) 100%, 0 100%, 0 28px)";

function Plus({ className }: { className: string }): ReactNode {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`pointer-events-none absolute z-10 h-3.5 w-3.5 text-[#2f80ff] ${className}`}
    >
      <path
        d="M12 4v16M4 12h16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FooterColumn({
  index,
  title,
  links,
  children,
}: {
  index: number;
  title: string;
  links: FooterLink[];
  children?: ReactNode;
}): ReactNode {
  const divided = index > 0;
  return (
    <div
      className={`relative md:px-8 ${divided ? "md:border-l md:border-border" : "md:pl-0"} ${
        index === 3 ? "md:pr-0" : ""
      }`}
    >
      {divided && (
        <>
          <Plus className="left-0 top-0 hidden -translate-x-1/2 -translate-y-1/2 md:block" />
          <Plus className="bottom-0 left-0 hidden -translate-x-1/2 translate-y-1/2 md:block" />
        </>
      )}

      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <ul className="mt-4 space-y-3">
        {links.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              className="focus-ring text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}

export function Footer(): ReactNode {
  const clip = { clipPath: PANEL_CLIP } as CSSProperties;

  return (
    <footer className="mx-auto max-w-[1440px] px-5 pb-10 sm:px-8 lg:px-10">
      <div className="bg-border p-px" style={clip}>
        <div
          className="bg-background p-8 sm:p-10 lg:p-14"
          style={clip}
        >
          <Logo />

          <div className="mt-12 grid grid-cols-2 gap-x-8 gap-y-10 md:mt-14 md:grid-cols-4 md:gap-x-0">
            {COLUMNS.map((col, i) => (
              <FooterColumn
                key={col.title}
                index={i}
                title={col.title}
                links={col.links}
              />
            ))}

            <FooterColumn
              index={2}
              title="Talk to us"
              links={[{ label: "hello@sarvathra.ai", href: "mailto:hello@sarvathra.ai" }]}
            >
              <div className="mt-6 flex flex-col items-start gap-2.5">
                <CutButton variant="solid" href="tel:+918040802529">
                  +91 80408 02529
                </CutButton>
              </div>
            </FooterColumn>
          </div>

          <div className="mt-12 flex flex-col-reverse items-start justify-between gap-6 pt-6 sm:flex-row sm:items-center md:mt-14">
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} Sarvathra. All rights reserved.
            </p>

            <div className="flex items-center gap-4">
              {SOCIALS.map((social, i) => (
                <div key={social.href} className="flex items-center gap-4">
                  {i > 0 && (
                    <span className="h-3.5 w-px bg-border" aria-hidden="true" />
                  )}
                  <a
                    href={social.href}
                    aria-label={social.label}
                    className="focus-ring text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {social.icon}
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
