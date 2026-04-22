/**
 * Seed script to import skills from Anthropic's skills repository
 *
 * Usage:
 *   npx tsx scripts/seed-skills.ts [skill-name]
 *
 * Examples:
 *   npx tsx scripts/seed-skills.ts pdf
 *   npx tsx scripts/seed-skills.ts --all
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();
const FILE_SEPARATOR = (filename: string) => `\x1FFILE:${filename}\x1E`;

interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
}

function parseFrontmatter(content: string): { metadata: SkillMetadata; body: string } {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return {
      metadata: { name: "Unknown", description: "" },
      body: content,
    };
  }

  const [, frontmatter, body] = frontmatterMatch;
  const metadata: SkillMetadata = { name: "Unknown", description: "" };

  frontmatter.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      if (key === "name") metadata.name = value.trim();
      if (key === "description") metadata.description = value.trim();
      if (key === "license") metadata.license = value.trim();
    }
  });

  return { metadata, body };
}

function readSkillFiles(skillDir: string, basePath: string = ""): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  const entries = fs.readdirSync(skillDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(skillDir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      files.push(...readSkillFiles(fullPath, relativePath));
      continue;
    }

    if (!entry.isFile() || entry.name.startsWith(".")) {
      continue;
    }

    try {
      const buffer = fs.readFileSync(fullPath);
      if (buffer.includes(0)) {
        console.warn(`  Skipping binary-like file with NUL byte: ${relativePath}`);
        continue;
      }

      files.push({ path: relativePath, content: buffer.toString("utf-8") });
    } catch {
      console.warn(`  Skipping unreadable file: ${relativePath}`);
    }
  }

  return files;
}

function serializeSkillFiles(files: Array<{ path: string; content: string }>): string {
  const skillMd = files.find((f) => f.path === "SKILL.md");
  const otherFiles = files.filter((f) => f.path !== "SKILL.md");

  if (!skillMd) {
    throw new Error("SKILL.md not found");
  }

  let result = skillMd.content;

  for (const file of otherFiles) {
    result += `\n${FILE_SEPARATOR(file.path)}\n${file.content}`;
  }

  return result;
}

async function importSkill(skillDir: string, authorId: string): Promise<void> {
  const skillName = path.basename(skillDir);
  console.log(`\nImporting skill: ${skillName}`);

  const files = readSkillFiles(skillDir);
  console.log(`  Found ${files.length} files`);

  const skillMdFile = files.find((f) => f.path === "SKILL.md");
  if (!skillMdFile) {
    console.error(`  ERROR: SKILL.md not found in ${skillDir}`);
    return;
  }

  const { metadata } = parseFrontmatter(skillMdFile.content);
  console.log(`  Name: ${metadata.name}`);
  console.log(`  Description: ${metadata.description.substring(0, 80)}...`);

  const content = serializeSkillFiles(files);

  const existing = await prisma.prompt.findFirst({
    where: {
      title: metadata.name,
      type: "SKILL",
      authorId,
    },
  });

  if (existing) {
    console.log(`  Skill "${metadata.name}" already exists, updating...`);
    await prisma.prompt.update({
      where: { id: existing.id },
      data: {
        content,
        description: metadata.description,
      },
    });
  } else {
    await prisma.prompt.create({
      data: {
        title: metadata.name,
        description: metadata.description,
        content,
        type: "SKILL",
        authorId,
        isPrivate: false,
      },
    });
    console.log(`  Created skill: ${metadata.name}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const skillsBaseDir = process.env.ANTHROPIC_SKILLS_DIR || "/tmp/anthropic-skills/skills";

  if (args.length === 0) {
    console.log("Usage:");
    console.log("  npx tsx scripts/seed-skills.ts <skill-name>  - Import a specific skill");
    console.log("  npx tsx scripts/seed-skills.ts --all         - Import all skills");
    console.log("  npx tsx scripts/seed-skills.ts --list        - List available skills");
    console.log("\nAvailable skills:");

    if (fs.existsSync(skillsBaseDir)) {
      const skills = fs.readdirSync(skillsBaseDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      skills.forEach((s) => console.log(`  - ${s}`));
    } else {
      console.log(`  (Skills repo not found at ${skillsBaseDir})`);
      console.log("  Clone it first or set ANTHROPIC_SKILLS_DIR to the skills directory.");
    }
    return;
  }

  let author = await prisma.user.findFirst({
    where: { role: "ADMIN" },
  });

  if (!author) {
    console.log("No admin user found. Creating system user...");
    author = await prisma.user.create({
      data: {
        email: "system@prompts.chat",
        username: "system",
        name: "System",
        role: "ADMIN",
      },
    });
  }

  console.log(`Using author: ${author.username} (${author.id})`);

  if (!fs.existsSync(skillsBaseDir)) {
    console.error(`Skills directory not found: ${skillsBaseDir}`);
    console.error("Clone the repo first or set ANTHROPIC_SKILLS_DIR to the skills directory.");
    return;
  }

  if (args[0] === "--all") {
    const skillDirs = fs.readdirSync(skillsBaseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(skillsBaseDir, d.name));

    console.log(`Found ${skillDirs.length} skills to import`);

    for (const skillDir of skillDirs) {
      try {
        await importSkill(skillDir, author.id);
      } catch (e) {
        console.error(`  ERROR importing ${path.basename(skillDir)}:`, e);
      }
    }
  } else if (args[0] === "--list") {
    const skills = fs.readdirSync(skillsBaseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    console.log("Available skills:");
    skills.forEach((s) => console.log(`  - ${s}`));
  } else {
    const skillDir = path.join(skillsBaseDir, args[0]);

    if (!fs.existsSync(skillDir)) {
      console.error(`Skill not found: ${args[0]}`);
      console.log("\nAvailable skills:");
      const skills = fs.readdirSync(skillsBaseDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      skills.forEach((s) => console.log(`  - ${s}`));
      return;
    }

    await importSkill(skillDir, author.id);
  }

  console.log("\nDone!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
