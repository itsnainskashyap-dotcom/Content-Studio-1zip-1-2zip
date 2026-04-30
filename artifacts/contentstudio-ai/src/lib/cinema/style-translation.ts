import type { CinemaState, StyleMode } from "./types";

/**
 * Style-specific Camera Translation Layer.
 *
 * Different visual styles understand "camera language" very differently:
 * a real 50mm focal length is meaningful for photoreal cinema but actively
 * harmful when the target is hand-drawn 2D anime (where it pushes the
 * model toward photo-realism / plastic 3D faces). This helper translates
 * the user's camera/lens picks into style-safe descriptive language.
 *
 * Output is a single descriptive string appended to the final image
 * prompt under the `STYLE-TRANSLATED CAMERA LANGUAGE:` header.
 */
export function translateCameraLanguageForStyle(state: CinemaState): string {
  const { styleMode, focalLength, aperture } = state;
  switch (styleMode) {
    case "photoreal_cinematic":
      return [
        `keep real cinema lens terminology — focal length ${focalLength}, aperture ${aperture}`,
        `use filmic optics, real bokeh shape, natural sensor grain, accurate lens flare`,
      ].join("; ");
    case "anime_2d":
      return [
        `treat camera framing as anime composition language, NOT real optics`,
        `use dynamic anime key pose, cel shading, painted background, anime close-up framing, speed perspective when motion is implied`,
        `do NOT render realistic skin pores, real camera noise, or plastic 3D faces`,
      ].join("; ");
    case "pixel_art":
      return [
        `treat camera framing as pixel-art composition language, NOT real optics`,
        `use crisp pixel grid, limited palette, side-scroller / isometric / top-down framing, parallax sprite layers`,
        `do NOT render shallow DOF blur, anti-aliased smooth edges, or photoreal textures`,
      ].join("; ");
    case "cgi_3d":
      return [
        `treat camera as a virtual rigged 3D camera with virtual focal length ${focalLength}, stylized depth of field`,
        `use global illumination, smooth subsurface skin, premium animated film polish`,
        `do NOT render cheap game-engine textures, unstable model design, or low-poly silhouettes`,
      ].join("; ");
    case "commercial_product":
      return [
        `camera language must emphasize product shape, material accuracy, controlled reflections, clean studio background`,
        `use focal length ${focalLength} and aperture ${aperture} as product framing guidance`,
        `do NOT render messy props, distorted text/logos, or chaotic backgrounds`,
      ].join("; ");
    default:
      return `focal length ${focalLength}, aperture ${aperture}`;
  }
}

export function styleModeLabel(mode: StyleMode): string {
  switch (mode) {
    case "photoreal_cinematic":
      return "Photorealistic Cinematic";
    case "anime_2d":
      return "2D Anime";
    case "pixel_art":
      return "Pixel Art";
    case "cgi_3d":
      return "3D CGI";
    case "commercial_product":
      return "Commercial Product";
  }
}
