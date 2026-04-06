// Allow importing CSS files as side-effects in TypeScript
declare module "*.css" {
  const _: unknown;
  export default _;
}
