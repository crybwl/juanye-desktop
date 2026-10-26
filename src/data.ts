import type { Exam, Layout, PaperSize, QType } from "./types";

export const TYPE_META: Record<QType, { label: string; short: string; hue: string }> = {
  single: { label: "单项选择题", short: "单选", hue: "#8fa8ff" },
  multi: { label: "多项选择题", short: "多选", hue: "#b79cff" },
  judge: { label: "判断题", short: "判断", hue: "#82b9e4" },
  blank: { label: "填空题", short: "填空", hue: "#6fd1c4" },
  essay: { label: "解答题", short: "解答", hue: "#f2b56f" },
  material: { label: "材料题", short: "材料", hue: "#dd9fba" },
  custom: { label: "自定义题型", short: "自定义", hue: "#a5b69e" },
};

export const CN_NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
export const LETTERS = ["A", "B", "C", "D", "E", "F"];

/** 纸张尺寸（mm） */
export const PAPER_MM: Record<PaperSize, [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  "8K": [270, 390],
  A5: [148, 210],
  B5: [176, 250],
  Letter: [215.9, 279.4],
};
export const MM = 96 / 25.4; // 1mm 对应的 CSS px

export const defaultLayout: Layout = {
  style: "real",
  density: "compact",
  paper: "A4",
  orientation: "portrait",
  margin: 11,
  fontSize: 9.5,
  lineHeight: 1.42,
  optionCols: "auto",
  pageNumber: true,
  showScore: true,
  keepTogether: false,
  answerSpace: false,
  paperMode: "questions",
  questionGap: 1.8,
  optionGap: 0.8,
};

export const uid = () => crypto.randomUUID();

export const sampleExam: Exam = {
  title: "卷页 · 数学示例试卷",
  subtitle: "示例内容，可自由编辑",
  duration: 120,
  notice: [
    "答题前，考生务必将自己的姓名、考生号、考场号、座位号填写在答题卡上。",
    "回答选择题时，选出每小题答案后，用铅笔把答题卡上对应题目的答案标号涂黑。如需改动，用橡皮擦干净后，再选涂其他答案标号。回答非选择题时，将答案写在答题卡上。写在本试卷上无效。",
    "考试结束后，将本试卷和答题卡一并交回。",
  ],
  sections: [
    {
      id: "s1",
      type: "single",
      title: "单项选择题",
      note: "本大题共 3 小题，每小题 5 分，共 15 分。每小题只有一个选项符合题意。",
      questions: [
        {
          id: "q1",
          type: "single",
          score: 5,
          stem: "已知集合 $A=\\{x\\mid -1\\le x<3\\}$，$B=\\{x\\mid 1<x\\le 4\\}$，则 $A\\cap B=$",
          options: ["$(-1,4]$", "$(1,3)$", "$[1,3)$", "$(-1,1]$"],
          answer: ["B"],
          analysis: "由交集定义，$A\\cap B=\\{x\\mid 1<x<3\\}=(1,3)$。",
        },
        {
          id: "q2",
          type: "single",
          score: 5,
          stem: "若复数 $z$ 满足 $z(1+i)=2$，则 $|z|=$",
          options: ["$1$", "$\\sqrt{2}$", "$2$", "$2\\sqrt{2}$"],
          answer: ["B"],
          analysis: "$z=\\dfrac{2}{1+i}=1-i$，所以 $|z|=\\sqrt{2}$。",
        },
        {
          id: "q3",
          type: "single",
          score: 5,
          stem:
            "(15分) 设实数 $a>1$，方程 $\\sin x = ax\\cos x$ 在区间 $(0,\\frac{\\pi}{2})$ 内的解记为 $x_a$。\n(1) 证明：对任意 $a>1$，原方程在区间 $(0,\\frac{\\pi}{2})$ 内有唯一实数解；\n(2) 设 $a,b,c>1$，且 $x_a,x_b,x_c$ 恰好可以作为一个三角形的三个内角，求 $a+b+c$ 的最小值。",
          options: ["", "", "", ""],
          answer: [],
          analysis: "",
          image: "plot",
          flag: "识别到小问 (1)(2) 且选项为空，疑似解答题",
        },
      ],
    },
    {
      id: "s2",
      type: "multi",
      title: "多项选择题",
      note: "本大题共 1 小题，每小题 6 分，共 6 分。每小题有多个选项符合题意；选对但不全得部分分，有选错得 0 分。",
      questions: [
        {
          id: "q4",
          type: "multi",
          score: 6,
          stem: "已知函数 $f(x)=x^3-3x$，则下列结论正确的是",
          options: [
            "$f(x)$ 是奇函数",
            "$x=-1$ 是极大值点",
            "$f(x)$ 在 $(-1,1)$ 上递增",
            "方程 $f(x)=0$ 有三个实根",
          ],
          answer: ["A", "B", "D"],
          analysis: "$f'(x)=3x^2-3$，在 $(-1,1)$ 上 $f'(x)<0$，函数递减，故 C 错误。",
        },
      ],
    },
    {
      id: "s3",
      type: "blank",
      title: "填空题",
      note: "本大题共 1 小题，每小题 5 分，共 5 分。",
      questions: [
        {
          id: "q5",
          type: "blank",
          score: 5,
          stem: "曲线 $y=x^2$ 在点 $(1,1)$ 处的切线斜率为______。",
          options: [],
          answer: ["2"],
          analysis: "$y'=2x$，当 $x=1$ 时斜率为 $2$。",
        },
      ],
    },
    {
      id: "s4",
      type: "essay",
      title: "解答题",
      note: "本大题共 2 小题，共 25 分。解答应写出必要的文字说明、证明过程或演算步骤。",
      questions: [
        {
          id: "q6",
          type: "essay",
          score: 13,
          stem:
            "已知数列 $\\{a_n\\}$ 的前 $n$ 项和为 $S_n$，且 $S_n=2a_n-2$。\n(1) 求数列 $\\{a_n\\}$ 的通项公式；\n(2) 若 $b_n=\\dfrac{n}{a_n}$，求数列 $\\{b_n\\}$ 的前 $n$ 项和 $T_n$。",
          options: [],
          answer: ["(1) $a_n=2^n$；(2) $T_n=2-\\dfrac{n+2}{2^n}$"],
          analysis: "",
        },
        {
          id: "q7",
          type: "essay",
          score: 12,
          stem:
            "设实数 $a>1$，方程 $$\\sin x = ax\\cos x$$ 在区间 $(0,\\frac{\\pi}{2})$ 内的解记为 $x_a$。\n(1) 证明：对任意 $a>1$，原方程在区间 $(0,\\frac{\\pi}{2})$ 内有唯一实数解；\n(2) 设 $a,b,c>1$，且 $x_a,x_b,x_c$ 恰好可以作为一个三角形的三个内角，求 $a+b+c$ 的最小值。",
          options: [],
          answer: [],
          analysis: "",
        },
      ],
    },
  ],
};

/** 大题说明自动生成（分值改动后同步更新） */
export function sectionNote(type: QType, scores: number[]) {
  const n = scores.length;
  const sum = scores.reduce((a, b) => a + b, 0);
  const same = n > 0 && scores.every((s) => s === scores[0]);
  const each = same ? `每小题 ${scores[0]} 分，` : "";
  switch (type) {
    case "single":
      return `本大题共 ${n} 小题，${each}共 ${sum} 分。每小题只有一个选项符合题意。`;
    case "multi":
      return `本大题共 ${n} 小题，${each}共 ${sum} 分。每小题有多个选项符合题意；选对但不全得部分分，有选错得 0 分。`;
    case "blank":
    case "judge":
    case "custom":
      return `本大题共 ${n} 小题，${each}共 ${sum} 分。`;
    default:
      return `本大题共 ${n} 小题，共 ${sum} 分。解答应写出必要的文字说明、证明过程或演算步骤。`;
  }
}
