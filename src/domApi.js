import kefir from 'kefir';

import { Set } from './util';


export default function DomApi(componentDestruction) {
  this.componentDestruction = componentDestruction;
  componentDestruction.onEnd(_ => this._destroy());
};

DomApi.prototype.onEvent = function(selector, evt) {
  this.eventSubs = this.eventSubs || [];

  const sub = { selector, evt };

  const stream = kefir.stream(emitter => {
    sub.emitter = emitter;
  });

  this.eventSubs.push(sub);
  if (this.el) subscribe(sub, this.el);

  return stream;
};

DomApi.prototype._activate = function(el) {
  if (!this.eventSubs) return;

  this.el = el;
  this.eventSubs.forEach(sub => subscribe(sub, el));
};

DomApi.prototype._destroy = function() {
  if (!this.eventSubs) return;

  this.eventSubs.forEach(sub => {
    const { evt, listener: { fn, useCapture }} = sub;
    this.el.removeEventListener(evt, fn, useCapture);
  });

  this.eventSubs = null;
};

function subscribe(sub, el) {
  const listener = evt => {
    // TODO: simulate bubbling (evt.target could be bellow our selector)
    if (matches(evt.target, sub.selector)) sub.emitter.emit(evt);
  }
  const useCapture = sub.evt in nonBubblingEvents;
  el.addEventListener(sub.evt, listener, useCapture);
  sub.listener = { fn: listener, useCapture };
}


const proto = Element.prototype;
const nativeMatches = proto.matches
  || proto.matchesSelector
  || proto.webkitMatchesSelector
  || proto.mozMatchesSelector
  || proto.msMatchesSelector
  || proto.oMatchesSelector;
function matches(el, selector) {
  return nativeMatches.call(el, selector);
}

const nonBubblingEvents = Set(
  `load`,
  `unload`,
  `focus`,
  `blur`,
  `mouseenter`,
  `mouseleave`,
  `submit`,
  `change`,
  `reset`,
  `timeupdate`,
  `playing`,
  `waiting`,
  `seeking`,
  `seeked`,
  `ended`,
  `loadedmetadata`,
  `loadeddata`,
  `canplay`,
  `canplaythrough`,
  `durationchange`,
  `play`,
  `pause`,
  `ratechange`,
  `volumechange`,
  `suspend`,
  `emptied`,
  `stalled`,
);