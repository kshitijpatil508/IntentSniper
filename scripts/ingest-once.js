import { Store } from "../server/store.js";
import { Ingestor } from "../server/ingest.js";

const store = new Store();
const ingestor = new Ingestor({ store });

await ingestor.loadSources();
const result = await ingestor.runOnce();
store.save();

console.log(JSON.stringify(result, null, 2));
console.log(`\nstore size: ${store.size}`);
console.log(JSON.stringify(store.stats(), null, 2));
