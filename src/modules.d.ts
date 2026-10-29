// CSS files are bundled as text (see "rules" in wrangler.jsonc).
declare module "*.css" {
  const css: string;
  export default css;
}
