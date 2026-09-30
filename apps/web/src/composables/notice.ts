/** The result of an action on a page ("Order 123 cancelled."), with its tone. */
export interface Notice {
  tone: "positive" | "negative";
  text: string;
}
