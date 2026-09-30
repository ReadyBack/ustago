/** Metro resolves a bundled image import to an asset id for <Image source>. */
declare module '*.png' {
  const asset: number;
  export default asset;
}
