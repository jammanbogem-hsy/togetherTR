// 브라우저를 열지 않고 복제·펼침·토글 제거의 DOM 동작을 검증하는 작은 테스트 픽스처.
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
class Text {
  nodeType = 3
  constructor(value, raw = false) { this.textContent = value; this.raw = raw }
  cloneNode() { return new Text(this.textContent, this.raw) }
  get html() { return this.raw ? this.textContent : escape(this.textContent) }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1) }
}
export class ReportDomElement {
  nodeType = 1
  constructor(tag, attributes = {}, ...children) {
    this.tagName = tag.toUpperCase()
    this.attributes = { ...attributes }
    this.children = children.map(child => typeof child === 'string' ? new Text(child) : child)
    this.children.forEach(child => { child.parent = this })
    const declarations = new Map((attributes.style ?? '').split(';').filter(Boolean).map(value => {
      const index = value.indexOf(':'); return [value.slice(0, index).trim(), value.slice(index + 1).trim()]
    }))
    const sync = () => { this.attributes.style = [...declarations].map(([key, value]) => `${key}:${value}`).join(';') }
    this.style = {
      getPropertyValue: key => (declarations.get(key) ?? '').replace(/\s*!important$/, ''),
      removeProperty: key => { declarations.delete(key); sync() },
    }
    const classes = () => (this.attributes.class ?? '').split(/\s+/).filter(Boolean)
    this.classList = {
      [Symbol.iterator]: () => classes()[Symbol.iterator](),
      remove: key => { this.attributes.class = classes().filter(value => value !== key).join(' ') },
    }
  }
  get childNodes() { return this.children }
  get ownerDocument() { return this.document ?? this.parent?.ownerDocument }
  get childElementCount() { return this.children.filter(child => child.nodeType === 1).length }
  get textContent() { return this.children.map(child => child.textContent).join('') }
  get innerHTML() { return this.children.map(child => child.html).join('') }
  get html() { return `<${this.tagName.toLowerCase()}${Object.entries(this.attributes).filter(([, value]) => value !== undefined).map(([key, value]) => ` ${key}="${escape(value)}"`).join('')}>${this.innerHTML}</${this.tagName.toLowerCase()}>` }
  cloneNode(deep) { return new ReportDomElement(this.tagName, this.attributes, ...(deep ? this.children.map(child => child.cloneNode(true)) : [])) }
  getAttribute(key) { return this.attributes[key] ?? null }
  hasAttribute(key) { return Object.hasOwn(this.attributes, key) }
  setAttribute(key, value) { this.attributes[key] = value }
  removeAttribute(key) { delete this.attributes[key] }
  matches(selector) {
    return selector.split(',').some(part => {
      const value = part.trim()
      if (value === '*') return true
      if (value.startsWith('.')) return [...this.classList].includes(value.slice(1))
      const attribute = value.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/)
      if (attribute) return this.hasAttribute(attribute[1]) && (attribute[2] === undefined || this.getAttribute(attribute[1]) === attribute[2])
      return this.tagName.toLowerCase() === value.toLowerCase()
    })
  }
  querySelectorAll(selector) {
    return this.children.filter(child => child.nodeType === 1).flatMap(child => [ ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)])
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) ?? null }
  getBoundingClientRect() {
    const top = Number(this.attributes['data-top'] ?? 0), height = Number(this.attributes['data-height'] ?? 0)
    return { top, bottom: top + height, height, width: 794, left: 0, right: 794 }
  }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1) }
  replaceWith(...children) {
    if (!this.parent) return
    const parent = this.parent, index = parent.children.indexOf(this)
    children.forEach(child => child.remove())
    parent.children.splice(index, 1, ...children)
    children.forEach(child => { child.parent = parent })
    this.parent = null
  }
}
export const reportDom = (tag, attributes, ...children) => new ReportDomElement(tag, attributes, ...children)
export function staticReportDom(markup) { return reportDom('div', {}, new Text(markup, true)) }
