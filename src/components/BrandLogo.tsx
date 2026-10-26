import logoMarkup from "../assets/juanye-icon.svg?raw";
import "./brand-logo.css";

/** The exact same local SVG is used in the title bar, favicon and native app icon. */
export function BrandLogo({ size = 28, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="brand-logo shrink-0"
      data-animate={animated ? "true" : undefined}
      style={{ width: size, height: size }}
      // Static repository artwork, never user/model markup. Keep the groups inline for the intro.
      dangerouslySetInnerHTML={{ __html: logoMarkup }}
    />
  );
}
