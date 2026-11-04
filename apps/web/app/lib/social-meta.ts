const ORIGIN = "https://meribel.clubathletic.org";

type SocialPage = {
  path: string;
  title: string;
  description: string;
  image?: "mountain" | "chalet";
  imageAlt?: string;
};

const IMAGES = {
  mountain: {
    path: "/video/meribel-peaks-poster.webp",
    width: "1600",
    height: "900",
    alt: "Snow-covered peaks in the Three Valleys beneath a bright mountain sky",
  },
  chalet: {
    path: "/chalet-rooms.webp",
    width: "1536",
    height: "1024",
    alt: "The Club Athletic Méribel chalet",
  },
} as const;

/** Return a complete social card because React Router uses only the deepest
 * matched route's metadata array. */
export function tripPageMeta({ path, title, description, image = "mountain", imageAlt }: SocialPage) {
  const preview = IMAGES[image];
  const url = `${ORIGIN}${path}`;
  const imageUrl = `${ORIGIN}${preview.path}`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Club Athletic" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:image", content: imageUrl },
    { property: "og:image:width", content: preview.width },
    { property: "og:image:height", content: preview.height },
    { property: "og:image:alt", content: imageAlt ?? preview.alt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: imageUrl },
    { tagName: "link", rel: "canonical", href: url },
  ];
}
