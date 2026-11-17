/*
 * The ISO 3166 catalog has exactly one copy on disk
 * (`packages/shared/data/iso3166.json`, AD-5) and is pulled into the Lambda
 * artifact by esbuild's JSON loader. `resolveJsonModule` is off in tsconfig.json
 * so tsc never infers a type from 25k lines of literal JSON; this declaration is
 * that type instead, and it is the shape `@nixus/shared`'s `LocationCountry`
 * expects.
 *
 * The file also carries `_source*` provenance members, which are deliberately
 * absent here: nothing in this service may serve them.
 */
declare module "*/iso3166.json" {
  const dataset: {
    readonly countries: readonly {
      readonly code: string;
      readonly name_en: string;
      readonly name_fr: string | null;
      readonly subdivisions: readonly {
        readonly code: string;
        readonly name_en: string;
        readonly name_fr: string | null;
      }[];
    }[];
  };
  export default dataset;
}
