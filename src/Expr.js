'use strict'

/**
 * A representation of a FaunaDB Query Expression. Generally, you shouldn't need
 * to use this class directly; use the Query helpers defined in {@link module:query}.
 *
 * @param {Object} obj The object that represents a Query to be treated as an Expression.
 * @constructor
 */
function Expr(obj) {
  this.raw = obj
}

Expr.prototype.toJSON = function() {
  return this.raw
}

var varArgsFunctions = [
  'Do',
  'Call',
  'Union',
  'Intersection',
  'Difference',
  'Equals',
  'Add',
  'BitAnd',
  'BitOr',
  'BitXor',
  'Divide',
  'Max',
  'Min',
  'Modulo',
  'Multiply',
  'Subtract',
  'LT',
  'LTE',
  'GT',
  'GTE',
  'And',
  'Or',
]
var specialCases = {
  is_nonempty: 'IsNonEmpty',
  lt: 'LT',
  lte: 'LTE',
  gt: 'GT',
  gte: 'GTE',
}

var keyPath = []
var compact = false
var printDepth = 0

var indent = function(input) {
  if (typeof input === 'function') {
    printDepth += 1
    var output = input()
    printDepth -= 1
    return output
  }
  if (compact) {
    return input
  }
  let indent = ''
  for (let i = 0; i < 2 * printDepth; i++) {
    indent += i % 2 ? '' : '・'
  }
  return indent + input
}

var eol = function(input) {
  return input + (compact ? '' : '\n')
}

var isCompact = function(expr) {
  return (
    !(expr instanceof Expr) &&
    !(expr && typeof expr == 'object' && !Array.isArray(expr))
  )
}

var printExpr = function(expr, options) {
  if (expr instanceof Expr) {
    if ('value' in expr) {
      return expr.toString()
    }
    expr = expr.raw
  }

  if (expr == null) {
    return String(expr)
  }

  switch (typeof expr) {
    case 'string':
      return JSON.stringify(expr)
    case 'boolean':
    case 'number':
    case 'symbol':
      return String(expr)
  }

  if (!options) {
    options = {}
  } else if (options === true) {
    options = { compact: true }
  }

  var map =
    options.map ||
    function(str) {
      return str
    }

  var printArgs = function(args) {
    var length = args.length
    return args
      .map(function(arg, i) {
        keyPath.push(i)
        arg = map(printExpr(arg, options), keyPath)
        keyPath.pop()
        if (i < length - 1) {
          arg += eol(',')
        }
        return i > 0 ? indent(arg) : arg
      })
      .join('')
  }

  var printArray = function(array, toStr) {
    if (!array.length) {
      return '[]'
    }
    var wasCompact = compact
    if (!wasCompact) {
      compact = array.every(isCompact)
    }
    var str =
      eol('[') +
      indent(function() {
        var length = array.length
        return array
          .map(function(value, i) {
            keyPath.push(i)
            value = map(toStr(value), keyPath)
            keyPath.pop()
            return indent(value) + (compact && i === length - 1 ? '' : eol(','))
          })
          .join('')
      }) +
      indent(']')
    compact = wasCompact
    return str
  }

  if (Array.isArray(expr)) {
    return printArray(expr, function(item) {
      return printExpr(item, options)
    })
  }

  var printObject = function(obj) {
    if (obj instanceof Expr) {
      obj = obj.raw
    }
    var keys = Object.keys(obj)
    var length = keys.length
    if (!length) {
      return '{}'
    }

    keyPath.push('object')
    var str =
      eol('{') +
      indent(function() {
        return keys
          .map(function(key, i) {
            keyPath.push(key)
            var value = map(printExpr(obj[key], options), keyPath)
            keyPath.pop()
            return (
              indent(key + ':' + (compact ? '' : ' ') + value) +
              (compact && i === length - 1 ? '' : eol(','))
            )
          })
          .join('')
      }) +
      indent('}')

    keyPath.pop()
    return str
  }

  if ('object' in expr) {
    return printObject(expr['object'])
  }

  var keys = Object.keys(expr)
  var fn =
    specialCases[keys[0]] ||
    keys[0]
      .split('_')
      .map(function(str) {
        return str.charAt(0).toUpperCase() + str.slice(1)
      })
      .join('')

  var wasCompact = compact
  if (!wasCompact) {
    compact = options.compact || keys.every(key => isCompact(expr[key]))
  }

  var args = indent(function() {
    var length = keys.length
    return keys.map(function(key, i) {
      keyPath.push(key)
      var arg = expr[key]
      if (arg instanceof Expr) {
        arg = arg.raw
      }
      var value = map(
        (key == fn.toLowerCase() &&
          (varArgsFunctions.indexOf(fn) >= 0
            ? printArgs(arg)
            : fn == 'Let' &&
              (Array.isArray(arg)
                ? printArray(arg, printObject)
                : printObject(arg)))) ||
          printExpr(arg, options),
        keyPath
      )
      keyPath.pop()
      return indent(value) + (compact && i === length - 1 ? '' : eol(','))
    })
  })

  var shouldReverseArgs = ['Filter', 'Map', 'Foreach'].indexOf(fn) != -1
  if (shouldReverseArgs) {
    args.reverse()
  }

  var out = eol(fn + '(') + args.join('') + indent(')')
  compact = wasCompact
  return out
}

Expr.toString = printExpr

module.exports = Expr
