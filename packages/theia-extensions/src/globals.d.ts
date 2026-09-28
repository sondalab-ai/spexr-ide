declare module "*.css";

/** Images the desktop build inlines as data URLs (gen-esbuild.browser.mjs). */
declare module "*.jpg" {
  const url: string;
  export default url;
}
