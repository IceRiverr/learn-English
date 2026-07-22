import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const titles = new Map([
  [1, "Excuse me!"],
  [3, "Sorry, sir."],
  [5, "Nice to meet you"],
  [7, "Are you a teacher?"],
  [9, "How are you today?"],
  [11, "Is this your shirt?"],
  [13, "A new dress"],
  [15, "Your passports, please."],
  [17, "How do you do"],
  [19, "Tired and thirsty"],
  [21, "Which book?"],
  [23, "Which glasses?"],
  [25, "Mrs. Smith's kitchen"],
  [27, "Mrs. Smith's living room"],
  [29, "Come in, Amy."],
  [31, "Where's Sally?"],
  [33, "A fine day"],
  [35, "Our village"],
  [37, "Making a bookcase"],
  [39, "Don't drop it!"],
  [41, "Penny's bag"],
  [43, "Hurry up!"],
  [45, "The boss's letter"],
  [47, "A cup of coffee"],
  [49, "At the butcher's"],
  [51, "A pleasant climate"],
  [53, "An interesting climate"],
  [55, "The Sawyer family"],
  [57, "An unusual day"],
  [59, "Is that all?"],
  [61, "A bad cold"],
  [63, "Thank you, doctor."],
  [65, "Not a baby"],
  [67, "The weekend"],
  [69, "The car race"],
  [71, "He's awful!"],
  [73, "The way to King Street"],
  [75, "Uncomfortable shoes"],
  [77, "Terrible toothache"],
  [79, "Carol's shopping-list"],
  [81, "Roast beef and potatoes"],
  [83, "Going on holiday"],
  [85, "Paris in the spring"],
  [87, "A car crash"],
  [89, "For sale"],
  [91, "Poor Ian"],
  [93, "Our new neighbour"],
  [95, "Tickets, please."],
  [97, "A small blue case"],
  [99, "Ow!"],
  [101, "A card from Jimmy"],
  [103, "The French test"],
  [105, "Full of mistakes"],
  [107, "It's too small."],
  [109, "A good idea"],
  [111, "The most expensive model"],
  [113, "Small change"],
  [115, "Knock, knock!"],
  [117, "Tommy's breakfast"],
  [119, "A true story"],
  [121, "The man in a hat"],
  [123, "A trip to Australia"],
  [125, "Tea for two"],
  [127, "A famous actress"],
  [129, "Seventy miles an hour"],
  [131, "Don't be so sure!"],
  [133, "Sensational news!"],
  [135, "The latest report"],
  [137, "A pleasant dream"],
  [139, "Is that you, John?"],
  [141, "Sally's first train ride"],
  [143, "A walk through the woods"]
]);

const projectDirectory = resolve(import.meta.dirname, "..");
const directory = resolve(projectDirectory, "public", "新概念", "新概念1-美音");
const files = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
if (files.length !== titles.size) throw new Error(`Expected ${titles.size} JSON files, found ${files.length}`);

let updated = 0;
let unchanged = 0;
for (const filename of files) {
  const match = /^(\d+)&(\d+)－/.exec(filename);
  if (!match) throw new Error(`Unexpected filename: ${filename}`);
  const lesson = Number(match[1]);
  const exerciseLesson = Number(match[2]);
  if (exerciseLesson !== lesson + 1 || lesson % 2 === 0) throw new Error(`Unexpected lesson pair: ${filename}`);
  const canonicalTitle = titles.get(lesson);
  if (!canonicalTitle) throw new Error(`Missing canonical title for Lesson ${lesson}`);

  const path = resolve(directory, filename);
  const course = JSON.parse(await readFile(path, "utf8"));
  const nextTitle = `Lesson ${lesson}: ${canonicalTitle}`;
  if (course.course.title === nextTitle) {
    unchanged += 1;
    continue;
  }
  course.course.title = nextTitle;
  await writeFile(path, `${JSON.stringify(course, null, 2)}\n`, "utf8");
  updated += 1;
}

console.log(JSON.stringify({ updated, unchanged }));
