/**
 * DOCX Generator (Sprint 3A.3)
 * Converts rendered template content to DOCX with simple paragraph layout.
 */

import fs from 'fs';
import { Document, Packer, Paragraph, TextRun } from 'docx';

export class DocxGenerator {
  static async generateFromText(content: string, outputPath: string): Promise<string> {
    const paragraphs = content.split('\n').map(line => {
      if (line.trim().length === 0) {
        return new Paragraph('');
      }
      return new Paragraph({
        children: [new TextRun({ text: line, font: 'Calibri', size: 22 })],
      });
    });

    const doc = new Document({
      sections: [{ children: paragraphs }],
    });

    const buffer = await Packer.toBuffer(doc);
    await fs.promises.writeFile(outputPath, buffer);

    return outputPath;
  }
}
