import { writeFileSync } from "node:fs";
import { buildRouteMap } from "./lib/route-map.mts";

writeFileSync("docs/ROUTES.md", buildRouteMap(process.cwd()));
console.log("docs/ROUTES.md updated");
