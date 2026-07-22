import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectDirectory = resolve(import.meta.dirname, "..");
const folders = ["新概念3-美音", "新概念4-美音"];
const titlePrefix = /^新概念英语第[三四]册\s+(?=Lesson\s+\d+:)/;
let updated = 0;
let unchanged = 0;

for (const folder of folders) {
  const directory = resolve(projectDirectory, "public", "新概念", folder);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();

  for (const filename of files) {
    const path = resolve(directory, filename);
    const course = JSON.parse(await readFile(path, "utf8"));
    const title = course?.course?.title;
    if (typeof title !== "string") throw new Error(`Missing course title in ${filename}`);

    const shortened = title.replace(titlePrefix, "");
    if (shortened === title) {
      if (!/^Lesson\s+\d+:/.test(title)) throw new Error(`Unexpected course title in ${filename}: ${title}`);
      unchanged += 1;
      continue;
    }

    course.course.title = shortened;
    await writeFile(path, `${JSON.stringify(course, null, 2)}\n`, "utf8");
    updated += 1;
  }
}

console.log(JSON.stringify({ updated, unchanged }));
