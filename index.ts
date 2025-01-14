import { google, docs_v1 } from "googleapis";
import { join } from "path";
import { config } from "dotenv";
import { promises as fs } from "fs";
config();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_DOCS_CLIENT_ID,
  process.env.GOOGLE_DOCS_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);
oauth2Client.setCredentials({
  access_token: process.env.GOOGLE_DOCS_ACCESS,
  refresh_token: process.env.GOOGLE_DOCS_REFRESH,
});
const docs = google.docs("v1");

export const fetchGoogleDocsFiles = async (files: string[]) => {
  for await (const documentId of files) {
    console.log("\nDownloading document", documentId);
    try {
      const result = await docs.documents.get({
        documentId: documentId.split(":")[0],
        auth: oauth2Client,
      });
      const title = documentId.includes(":")
        ? documentId.split(":")[1]
        : `${result.data.title}.md`;
      if (!title) throw new Error("Title not found");
      await fs.writeFile(join(".", title), googleDocsToMarkdown(result.data));
      console.log("Downloaded document", result.data.title);
    } catch (error) {
      console.log("Got an error", error);
    }
  }
};

// Find image / inline object
const getInlineObjectUrl = (file: any, inlineObjectKeyToFind: string): any => {
  if(! file.inlineObjects) return;
  let url: string = '';
  Object.keys(file.inlineObjects).forEach((key: string) => {
    if(key == inlineObjectKeyToFind) {
      url = file.inlineObjects[key].inlineObjectProperties?.embeddedObject?.imageProperties?.contentUri;
    }
  })
  return url;
}

export const googleDocsToMarkdown = (file: docs_v1.Schema$Document) => {
  let text = `---
title: ${file.title}
documentId: ${file.documentId}
revisionId: ${file.revisionId}
---

`;
  file.body?.content?.forEach((item) => {
    // Replace 'hard returns' to normal returns:
    text = text.replace("\v", "<br />");

    /**
     * Tables
     */
    if (item.table?.tableRows) {
      // Make a blank header
      const cells = item.table.tableRows[0]?.tableCells;
      // Make a blank header
      text += `|${cells?.map(() => "").join("|")}|\n|${cells
        ?.map(() => "-")
        .join("|")}|\n`;
      item.table.tableRows.forEach(({ tableCells }) => {
        const textRows: any[] = [];
        tableCells?.forEach(({ content }) => {
          content?.forEach(({ paragraph }) => {
            const styleType =
              paragraph?.paragraphStyle?.namedStyleType || undefined;

            textRows.push(
              paragraph?.elements?.map((element) =>
                // styleElement(element, styleType)?.replace(/\s+/g, "").trim()
                styleElement(element, styleType)?.trim()
              )
            );
          });
        });
        text += `| ${textRows.join(" | ")} |\n`;
      });
    }

    /**
     * Paragraphs, lists and images
     */
    if (item.paragraph && item.paragraph.elements) {
      const styleType =
        item?.paragraph?.paragraphStyle?.namedStyleType || undefined;
      const bullet = item.paragraph?.bullet;
      if (bullet?.listId) {
        const listDetails = file.lists?.[bullet.listId];
        const glyphFormat =
          listDetails?.listProperties?.nestingLevels?.[0].glyphFormat || "";
        const padding = "  ".repeat(bullet.nestingLevel || 0);
        if (["[%0]", "%0."].includes(glyphFormat)) {
          text += `${padding}1. `;
        } else {
          text += `${padding}- `;
        }
      }
      let headingBuilder = '', elementCounter = 1;
      item.paragraph.elements.forEach((element) => {
        // Headings
        if (element.textRun && styleType && styleType.indexOf('HEADING_') > -1) {
          // For headings, always merge multiple elements into one
          // See https://github.com/bartwr/docs-markdown/issues/1 for context
          //
          // Build heading string based on the different elements
          headingBuilder += element.textRun.content;
          // If we are at the last element: replace element content with full heading string
          if(elementCounter == item?.paragraph?.elements?.length) {
            const updatedElement = {...element, ...{
              textRun: {
                content: headingBuilder,
                textStyle: element.textRun.textStyle
              }
            }};
            text += styleElement(updatedElement, styleType);
          }
          elementCounter++;
        }
        // Normal paragraphs
        else if (element.textRun && content(element) && content(element) !== "\n") {
          text += styleElement(element, styleType);
        }
        // Image
        else if (element.inlineObjectElement && element.inlineObjectElement.inlineObjectId) {
          const imageUrl: string = getInlineObjectUrl(file, element.inlineObjectElement.inlineObjectId);
          text += '![img]('+imageUrl+')';
        }
      });
      text += bullet?.listId
        ? (text.split("\n").pop() || "").trim().endsWith("\n")
          ? ""
          : "\n"
        : "\n\n";
    }
  });

  const lines = text.split("\n");
  const linesToDelete: number[] = [];
  lines.forEach((line, index) => {
    if (index > 2) {
      if (
        !line.trim() &&
        ((lines[index - 1] || "").trim().startsWith("1. ") ||
          (lines[index - 1] || "").trim().startsWith("- ")) &&
        ((lines[index + 1] || "").trim().startsWith("1. ") ||
          (lines[index + 1] || "").trim().startsWith("- "))
      )
        linesToDelete.push(index);
    }
  });
  text = text
    .split("\n")
    .filter((_, i) => !linesToDelete.includes(i))
    .join("\n");

  return text.replace(/\n\s*\n\s*\n/g, "\n\n") + "\n";
};

const styleElement = (
  element: docs_v1.Schema$ParagraphElement,
  styleType?: string
): string | undefined => {
  if (styleType === "TITLE") {
    return `# ${content(element)}`;
  } else if (styleType === "SUBTITLE") {
    return `_${(content(element) || "").trim()}_`;
  } else if (styleType === "HEADING_1") {
    return `## ${content(element)}`;
  } else if (styleType === "HEADING_2") {
    return `### ${content(element)}`;
  } else if (styleType === "HEADING_3") {
    return `#### ${content(element)}`;
  } else if (styleType === "HEADING_4") {
    return `##### ${content(element)}`;
  } else if (styleType === "HEADING_5") {
    return `###### ${content(element)}`;
  } else if (styleType === "HEADING_6") {
    return `####### ${content(element)}`;
  } else if (
    element.textRun?.textStyle?.bold &&
    element.textRun?.textStyle?.italic
  ) {
    return `**_${content(element)}_**`;
  } else if (element.textRun?.textStyle?.italic) {
    return `_${content(element)}_`;
  } else if (element.textRun?.textStyle?.bold) {
    return `**${content(element)}**`;
  }

  return content(element);
};

const content = (
  element: docs_v1.Schema$ParagraphElement
): string | undefined => {
  const textRun = element?.textRun;
  const text = textRun?.content;
  if (textRun?.textStyle?.italic) {
    // Replace \n-tail
    return text ? text.replace("\n", "") : undefined;
  }
  if (textRun?.textStyle?.bold) {
    // Replace \n-tail
    return text ? text.replace("\n", "") : undefined;
  }
  if (textRun?.textStyle?.link?.url)
    return `[${text}](${textRun.textStyle.link.url})`;
  return text || undefined;
};
