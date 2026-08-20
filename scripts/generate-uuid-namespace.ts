import { v5 as uuidv5 } from "uuid";

const NAMESPACE_NAME = "majikah:majik-file-cloud";

// UUID v5's standard URL namespace.
// Used only to deterministically derive our own Majikah namespace.
const ROOT_NAMESPACE = uuidv5.URL;

const namespace = uuidv5(NAMESPACE_NAME, ROOT_NAMESPACE);

console.log("Majikah Namespace Generator");
console.log("============================");
console.log(`Name:      ${NAMESPACE_NAME}`);
console.log(`Namespace: ${namespace}`);
console.log("");
console.log("Use this value permanently in Majik File Cloud:");
console.log("");
console.log(`export const MAJIK_FILE_CLOUD_NAMESPACE = "${namespace}";`);
