/**
 * Prompt to instruct the LLM to provide changes in diff format
 */
export const diffFormatPrompt = `
When suggesting code changes, please provide them in unified diff format. This helps me apply precise changes to specific parts of files.

Example of a good diff format:

\`\`\`diff
--- a/path/to/file.js
+++ b/path/to/file.js
@@ -10,7 +10,7 @@
 function example() {
-  console.log("old code");
+  console.log("new code");
   return true;
 }
\`\`\`

The diff format should include:
1. File paths (--- a/path/to/file.js and +++ b/path/to/file.js)
2. Hunk headers (@@ -lineNum,numLines +lineNum,numLines @@)
3. Context lines (unchanged lines)
4. Removed lines (prefixed with -)
5. Added lines (prefixed with +)

This format allows for precise application of changes to specific parts of files rather than replacing entire files.
`;
