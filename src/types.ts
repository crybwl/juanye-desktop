export type QType = "single" | "multi" | "judge" | "blank" | "essay" | "material" | "custom";

export interface QuestionFigure {
  id: string;
  src: string;
  caption?: string;
  layout: "right" | "half" | "full";
  width?: number;
  maxHeight?: number;
}

export interface Question {
  id: string;
  type: QType;
  score: number;
  /** 题干，公式使用 $...$、\\(...\\)、\\[...\\] */
  stem: string;
  options: string[];
  /** 选择题存字母，填空/解答存文本 */
  answer: string[];
  analysis: string;
  image?: "plot";
  sourceImage?: string;
  figure?: string;
  figures?: QuestionFigure[];
  drawing?: string;
  source?: string;
  knowledge?: string[];
  difficulty?: "easy" | "medium" | "hard";
  pageBreakBefore?: boolean;
  /** 原文件题号，便于单独导入答案解析后按来源题号匹配。 */
  importNumber?: number;
  /** 仅控制独立答题卡。 */
  answerSpace?: "auto" | "quarter" | "half" | "full";
  /** 一体卷中的答题空间；未设置时跟随答题卡。 */
  paperAnswerSpace?: "auto" | "quarter" | "half" | "full";
  /** 校对提示：例如 OCR 识别出的可疑结构 */
  flag?: string;
}

export interface Section {
  id: string;
  type: QType;
  title: string;
  note: string;
  pageBreakBefore?: boolean;
  questions: Question[];
}

export interface Exam {
  title: string;
  subtitle: string;
  duration: number;
  notice: string[];
  sections: Section[];
}

export type PaperSize = "A4" | "A5" | "B5" | "Letter";

export interface Layout {
  style: "real" | "structured";
  density: "compact" | "standard" | "loose";
  paper: PaperSize;
  orientation: "portrait" | "landscape";
  margin: number; // mm
  fontSize: number; // pt
  lineHeight: number;
  optionCols: "auto" | 4 | 2 | 1;
  pageNumber: boolean;
  showScore: boolean;
  keepTogether: boolean;
  /** 旧项目兼容字段；卷内是否留白以 paperMode 为准。 */
  answerSpace: boolean;
  paperMode?: "questions" | "integrated";
  questionGap?: number;
  optionGap?: number;
  figureWidth?: number;
  figureGap?: number;
  answerMode?: "none" | "brief" | "full";
  quickAnswers?: boolean;
}

export type Mode = "edit" | "preview";
export type PreviewView = "paper" | "card";
