import h from 'snabbdom/h'
import { renderComponentNextFrame, renderComponentNow, renderNewComponentNow } from './render'
import { shallowEqual } from './util'
import Messages from './messages'
import { Observable } from '../observable'
import { Store } from '../store'
import log, { shouldLog } from './log'


const empty = {}

export default function Component(options) {
  const { name, props = empty, sel = 'component', initState, connect, render, log = true } = options

  const key = props.key === undefined ? name : `${name}_${props.key}`

  const data = {
    key,
    hook: { insert, postpatch, destroy },
    component: { props, initState, connect, render, key: name, log },
    attrs: { name }
  }

  // An empty placeholder is returned, and that's all our parent is going to see.
  // Each component handles its own internal rendering.
  const compVnode = h(sel, data)
  data.component.compVnode = compVnode
  return compVnode
}

function insert(vnode) {
  const { component } = vnode.data
  const { props, initState, connect } = component

  let connected = false

  // Lookup from HTML Element to component, used in DOM-based messaging
  vnode.elm.__comp__ = component

  // Store the component depth once it's attached to the DOM so we can render
  // component hierarchies in a predictive (top -> down) manner.
  component.depth = getDepth(vnode.elm)

  // Internal callbacks
  component.lifecycle = {
    rendered
  }

  const messages = new Messages(vnode.elm)

  component.elm = vnode.elm
  component.messages = messages

  const propsObservable = Observable(add => {
    add(component.props)
    component.lifecycle.propsChanged = add
  }).named('props')

  // Eagerly subscribe so that the observable get its first value and we honour
  // the ObservableWithInitialValue interface contract.
  propsObservable.subscribe(x => x)

  component.store = Store(initState(props), ({on, msg, state}) => {
    messages.storeMsg = msg

    const connectParams = {
      on,
      state,
      props: propsObservable,
      msg: messages
    }

    connect(connectParams)
    connected = true

    // First render.
    // Render right after our parent (which is in the middle of a patch)
    // so that we honour the snabbdom's insert hook,
    // e.g we get patched into our parent after our parent was added to the document.
    renderNewComponentNow(component)

  }, {
    name: component.key,
    log: shouldLog(log.message, component)
  })

  component.store.state.sliding2().subscribe(([newState, oldState]) => {

    const shouldRender =
      // Skip the first notification (hot observable)
      oldState &&
      // synchronous observables triggering before the first render should just be accumulated
      connected &&
      // the props observable triggered, a synchronous render is made right after so skip
      !component.lifecycle.propsChanging &&
      // null update
      !shallowEqual(oldState, newState)

    if (shouldRender)
      renderComponentNextFrame(component)
  })
}

// Called on every parent re-render, this is where the props passed by the component's parent may have changed.
function postpatch(oldVnode, vnode) {
  const oldData = oldVnode.data
  const newData = vnode.data

  // Server side rendering: Reconcilating with a server-rendered node will have skipped calling insert()
  if (!oldData.component) {
    insert(vnode)
  }

  // oldData wouldn't have a component reference set if it came from the server (it's first set in insert())
  const component = oldData.component || newData.component
  const oldProps = component.props
  const newProps = newData.component.props

  // Update the original component with any property that may have changed during this render pass
  component.props = newProps

  newData.component = component

  // If the props changed, render immediately as we are already
  // in the render context of our parent
  if (!shallowEqual(oldProps, newProps)) {

    component.lifecycle.propsChanging = true
    component.lifecycle.propsChanged(newProps)
    component.lifecycle.propsChanging = false

    renderComponentNow(component)
  }
}

function rendered(component, newVnode) {
  // Store the new vnode inside the component so we can diff it next render
  component.vnode = newVnode

  // For now, only lift the hook of non Array render outputs
  if (newVnode && !Array.isArray(newVnode)) {
    // Lift any 'remove' hook to our placeholder vnode for it to be called
    // as the placeholder is all our parent vnode knows about.
    // TODO: Call all the hooks of an Array VNode?
    const hook = newVnode.data.hook && newVnode.data.hook.remove
    if (hook) component.compVnode.data.hook.remove = hook
  }
}

function destroy(vnode) {
  const comp = vnode.data.component
  comp.vnode.elm.__comp__ = null

  Array.isArray(comp.vnode)
    ? comp.vnode.forEach(destroyVnode)
    : destroyVnode(comp.vnode)

  comp.store.destroy()

  comp.destroyed = true
}

// Destroy our vnode recursively
// Note: Can't invoke modules' destroy hook as they're hidden in snabbdom's closure.
// The default modules don't do anything in destroy() anyway.
function destroyVnode(vnode) {
  if (!vnode) return

  const data = vnode.data

  if (!data) return

  if (data.hook && data.hook.destroy) data.hook.destroy(vnode)
  if (vnode.children) vnode.children.forEach(destroyVnode)
}

function getDepth(elm) {
  let depth = 0
  let parent = elm.parentElement
  while (parent) {
    depth++
    parent = parent.parentElement
  }
  return depth
}
