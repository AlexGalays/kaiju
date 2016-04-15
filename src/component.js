import h from 'snabbdom/h';
import kefir from 'kefir';

import { renderComponentNow, renderComponent } from './render';
import shallowEqual from './shallowEqual';
import DomAPi from './domApi';


const empty = {};

export default function Component(options) {
  const { key, props = empty, connect, render } = options;

  const compProps = {
    key,
    hook: { create, postpatch, destroy },
    component: { props, connect, render, key }
  };

  // An empty placeholder is returned, and that's all our parent is going to see.
  // Components handle their own internal rendering.
  return h('div', compProps);
};

// Called when the component is created but isn't yet attached to the DOM
function create(_, vnode) {
  const { component } = vnode.data;
  const { props, connect } = component;

  component.lifecycle = {
    inserted,
    rendered
  };

  // A stream which only produces one value at component destruction time
  const componentDestruction = kefir.stream(emitter => {
    component.lifecycle.destroyed = () => {
      emitter.emit();
      emitter.end();
    }
  });

  // The stream of changing props given by the component's parent
  const propStream = kefir.stream(emitter => {
    component.lifecycle.propsChanged = newProps => emitter.emit(newProps)
  }).toProperty(() => props);

  const domApi = new DomAPi(componentDestruction);

  const state = connect(domApi, propStream).takeUntilBy(componentDestruction);
  let stateCalled = false;

  component.elm = vnode.elm;
  component.placeholder = vnode;

  state.onValue(state => {
    stateCalled = true;

    const oldState = component.state;
    component.state = state;

    // First render:
    // Create and insert the component's content
    // while its parent is still unattached for better perfs.
    if (oldState === undefined) {
      renderComponentNow(component);
      component.placeholder.elm = component.vnode.elm;
      component.placeholder.elm.__comp__ = component;
      domApi._activate(component.vnode.elm);
    }

    else if (!shallowEqual(oldState, state))
      renderComponent(component);
  });

  if (!stateCalled)
    console.error('state() returned a Property without an initial value for component',
      component.elm, component.key);
}

// Store the component depth once it's attached to the DOM so we can render
// component hierarchies in a predictive manner.
function inserted(component) {
  component.depth = getDepth(component.vnode.elm);
}

// Called on every re-render, this is where the props passed by the component's parent may have changed.
function postpatch(oldVnode, vnode) {
  const oldData = oldVnode.data;
  const newData = vnode.data;

  // Pass on the component instance everytime a new Vnode instance is created,
  // but update any important property that can change over time.
  const component = oldData.component;
  component.props = newData.component.props;
  component.render = newData.component.render;
  component.placeholder = vnode;
  newData.component = component;

  if (!shallowEqual(newData.props, oldData.props))
    component.lifecycle.propsChanged(newData.props);
}

function rendered(component, newVnode) {
  let i;

  // Store the new vnode inside the component so we can diff it next render
  component.vnode = newVnode;

  // Lift any 'remove' hook to our placeholder vnode for it to be called
  // as the placeholder is all our parent vnode knows about.
  if ((i = newVnode.data.hook) && (i = i.remove))
    component.placeholder.data.hook.remove = i;
}

function destroy(vnode) {
  const comp = vnode.data.component;
  comp.vnode.elm.__comp__ = null;

  destroyVnode(comp.vnode);
  comp.destroyed = true;
  comp.lifecycle.destroyed();
}

// Destroy our vnode recursively
function destroyVnode(vnode) {
  const data = vnode.data;

  if (!data) return;
  if (data.hook && data.hook.destroy) data.hook.destroy(vnode);
  // Can't invoke modules' destroy hook as they're hidden in snabbdom's closure
  if (vnode.children) vnode.children.forEach(destroyVnode);
  if (data.vnode) destroyVnode(data.vnode);
}

function getDepth(elm) {
  let depth = 0;
  let parent = elm.parentElement;
  while (parent) {
    depth++;
    parent = parent.parentElement;
  }
  return depth;
}
