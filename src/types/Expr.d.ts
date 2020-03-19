export default class Expr {
  constructor(obj: object)

  static toString(expr: Expr, compact?: boolean): string
  static toString(
    expr: Expr,
    options?: {
      compact?: boolean
      map?: (str: string, keyPath: string[]) => string
    }
  ): string
}
