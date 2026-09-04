import type { Metadata } from "next";

export const siteConfig = {
  name: "Sarvathra",
  shortDescription: "The calls you miss are patients you lose.",
  description:
    "Sarvathra answers the phone and the WhatsApp line for clinics and hospitals in India, in Hindi or English, around the clock. It books and cancels appointments, gives timings and directions, hands the call to your front desk when the caller asks, and writes the outcome into your records.",
  url: "https://sarvathra.ai",
  ogImage: "/sarvathra-mark@2x.png",
  // No social account is claimed here. The template pointed `creator` at an
  // @handle and the JSON-LD turned that into a `sameAs`, which asserts an
  // account exists — a structured-data claim search engines act on.
  creator: "Sarvathra",
  authors: [
    {
      name: "Sarvathra",
      url: "https://sarvathra.ai",
    },
  ],
  telephone: "+91 80408 02529",
  email: "hello@sarvathra.ai",
  keywords: [
    "Sarvathra",
    "AI receptionist",
    "clinic phone answering",
    "hospital call automation",
    "appointment booking by phone",
    "Hindi voice AI",
    "WhatsApp Business calling",
    "patient calls",
    "missed call recovery",
    "India",
  ],
} as const;

export const baseMetadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — ${siteConfig.shortDescription}`,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: [...siteConfig.keywords],
  authors: [...siteConfig.authors],
  creator: siteConfig.creator,
  publisher: siteConfig.name,
  category: "technology",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteConfig.url,
    title: `${siteConfig.name} — ${siteConfig.shortDescription}`,
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} — ${siteConfig.shortDescription}`,
    description: siteConfig.description,
    images: [siteConfig.ogImage],
    creator: siteConfig.creator,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-icon.svg",
  },
  manifest: "/site.webmanifest",
};

export function createMetadata({
  title,
  description,
  path = "/",
  image,
  noIndex = false,
}: {
  title?: string;
  description?: string;
  path?: string;
  image?: string;
  noIndex?: boolean;
}): Metadata {
  const url = `${siteConfig.url}${path}`;
  const ogImage = image ?? siteConfig.ogImage;
  const finalTitle = title ?? `${siteConfig.name} — ${siteConfig.shortDescription}`;
  const finalDesc = description ?? siteConfig.description;

  return {
    // **Not `title ?? null`**, which is what this was. In Next, `null`
    // suppresses the title rather than deferring to the parent — it exists to
    // let a page opt out of a layout's `title.template`. This app's root
    // layout sets a plain string and no template, so `null` wiped it and the
    // page shipped with no `<title>` at all while `og:title` looked correct.
    title: finalTitle,
    description: finalDesc,
    alternates: {
      // Absolute. `metadataBase` lives in the template's own root layout,
      // which this app does not use — so a relative value stayed relative in
      // the HTML, and a canonical is the one link that must be unambiguous
      // about which host it means. This site answers on two.
      canonical: url,
    },
    openGraph: {
      title: finalTitle,
      description: finalDesc,
      url,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: finalTitle,
        },
      ],
    },
    twitter: {
      title: finalTitle,
      description: finalDesc,
      images: [ogImage],
    },
    ...(noIndex && {
      robots: {
        index: false,
        follow: false,
      },
    }),
  };
}
