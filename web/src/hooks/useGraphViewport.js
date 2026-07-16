import { useCallback, useEffect, useRef, useState } from 'react';

export const GRAPH_MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const DRAG_THRESHOLD = 8;
const MAX_MOMENTUM_VELOCITY = 1600;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function localPoint(element, clientX, clientY) {
  const rect = element.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function useGraphViewport({ initialView, reducedMotion = false, onDoubleTap }) {
  const [view, setViewState] = useState(initialView);
  const [isInteracting, setIsInteracting] = useState(false);
  const viewRef = useRef(initialView);
  const animationFrameRef = useRef(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef({ mode: null });
  const wheelGestureRef = useRef({ mode: null, lastTime: 0, ctrlKey: false });
  const historyRef = useRef([]);
  const lastTapRef = useRef(null);
  const dragMovedRef = useRef(false);
  const userInteractedRef = useRef(false);
  const interactionVersionRef = useRef(0);

  const markUserInteraction = useCallback(() => {
    userInteractedRef.current = true;
    interactionVersionRef.current += 1;
  }, []);

  const commitView = useCallback((next) => {
    const normalized = {
      x: Number.isFinite(next.x) ? next.x : 0,
      y: Number.isFinite(next.y) ? next.y : 0,
      k: clamp(Number.isFinite(next.k) ? next.k : 1, GRAPH_MIN_ZOOM, MAX_ZOOM),
    };
    viewRef.current = normalized;
    setViewState(normalized);
  }, []);

  const cancelAnimation = useCallback(() => {
    if (animationFrameRef.current != null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  useEffect(() => cancelAnimation, [cancelAnimation]);

  useEffect(() => {
    if (reducedMotion) cancelAnimation();
  }, [cancelAnimation, reducedMotion]);

  const animateTo = useCallback((target, { velocity = { x: 0, y: 0, k: 0 } } = {}) => {
    cancelAnimation();
    const normalizedTarget = {
      x: target.x,
      y: target.y,
      k: clamp(target.k, GRAPH_MIN_ZOOM, MAX_ZOOM),
    };
    if (reducedMotion) {
      commitView(normalizedTarget);
      return;
    }

    const position = { ...viewRef.current };
    const currentVelocity = { ...velocity };
    const response = 0.38;
    const omega = (2 * Math.PI) / response;
    const stiffness = omega * omega;
    const damping = 2 * omega;
    let previousTime = performance.now();

    const step = (time) => {
      const dt = Math.min(0.032, Math.max(0.001, (time - previousTime) / 1000));
      previousTime = time;
      let settled = true;

      for (const key of ['x', 'y', 'k']) {
        const acceleration = (normalizedTarget[key] - position[key]) * stiffness
          - currentVelocity[key] * damping;
        currentVelocity[key] += acceleration * dt;
        position[key] += currentVelocity[key] * dt;
        const positionTolerance = key === 'k' ? 0.0005 : 0.15;
        const velocityTolerance = key === 'k' ? 0.002 : 2;
        if (Math.abs(normalizedTarget[key] - position[key]) > positionTolerance
          || Math.abs(currentVelocity[key]) > velocityTolerance) settled = false;
      }

      if (settled) {
        animationFrameRef.current = null;
        commitView(normalizedTarget);
        return;
      }
      commitView(position);
      animationFrameRef.current = requestAnimationFrame(step);
    };
    animationFrameRef.current = requestAnimationFrame(step);
  }, [cancelAnimation, commitView, reducedMotion]);

  const startMomentum = useCallback(() => {
    if (reducedMotion || historyRef.current.length < 2) return;
    const now = performance.now();
    const history = historyRef.current.filter((entry) => now - entry.time <= 110);
    if (history.length < 2) return;
    const first = history[0];
    const last = history[history.length - 1];
    const elapsed = Math.max(16, last.time - first.time) / 1000;
    let velocityX = clamp((last.x - first.x) / elapsed, -MAX_MOMENTUM_VELOCITY, MAX_MOMENTUM_VELOCITY);
    let velocityY = clamp((last.y - first.y) / elapsed, -MAX_MOMENTUM_VELOCITY, MAX_MOMENTUM_VELOCITY);
    if (Math.hypot(velocityX, velocityY) < 120) return;

    cancelAnimation();
    let previousTime = performance.now();
    const step = (time) => {
      const dtMs = Math.min(32, time - previousTime);
      previousTime = time;
      const decay = Math.pow(0.9, dtMs / 16.67);
      velocityX *= decay;
      velocityY *= decay;
      const current = viewRef.current;
      commitView({
        x: current.x + velocityX * (dtMs / 1000),
        y: current.y + velocityY * (dtMs / 1000),
        k: current.k,
      });
      if (Math.hypot(velocityX, velocityY) < 18) {
        animationFrameRef.current = null;
        return;
      }
      animationFrameRef.current = requestAnimationFrame(step);
    };
    animationFrameRef.current = requestAnimationFrame(step);
  }, [cancelAnimation, commitView, reducedMotion]);

  const beginPan = useCallback((pointer) => {
    const current = viewRef.current;
    gestureRef.current = {
      mode: 'pan',
      startX: pointer.x,
      startY: pointer.y,
      viewX: current.x,
      viewY: current.y,
    };
    historyRef.current = [{ x: pointer.x, y: pointer.y, time: performance.now() }];
  }, []);

  const beginPinch = useCallback((element) => {
    const points = [...pointersRef.current.values()].slice(0, 2);
    if (points.length < 2) return;
    const a = localPoint(element, points[0].x, points[0].y);
    const b = localPoint(element, points[1].x, points[1].y);
    const center = midpoint(a, b);
    const current = viewRef.current;
    gestureRef.current = {
      mode: 'pinch',
      startDistance: Math.max(1, distance(a, b)),
      startK: current.k,
      worldX: (center.x - current.x) / current.k,
      worldY: (center.y - current.y) / current.k,
    };
    dragMovedRef.current = true;
  }, []);

  const onPointerDown = useCallback((event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    cancelAnimation();
    markUserInteraction();
    wheelGestureRef.current = { mode: null, lastTime: 0, ctrlKey: false };
    // Capture on the original hit target so the eventual click remains
    // targeted at the node. Pointer moves still bubble to the SVG handler.
    const captureTarget = typeof event.target?.setPointerCapture === 'function'
      ? event.target
      : event.currentTarget;
    try { captureTarget.setPointerCapture?.(event.pointerId); } catch { /* unsupported target */ }
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      captureTarget,
    });
    setIsInteracting(true);

    if (pointersRef.current.size === 1) {
      dragMovedRef.current = false;
      beginPan({ x: event.clientX, y: event.clientY });
    } else if (pointersRef.current.size === 2) {
      beginPinch(event.currentTarget);
    }
  }, [beginPan, beginPinch, cancelAnimation, markUserInteraction]);

  const onPointerMove = useCallback((event) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    event.preventDefault();
    const previous = pointersRef.current.get(event.pointerId);
    pointersRef.current.set(event.pointerId, {
      ...previous,
      x: event.clientX,
      y: event.clientY,
    });

    if (pointersRef.current.size >= 2) {
      if (gestureRef.current.mode !== 'pinch') beginPinch(event.currentTarget);
      const points = [...pointersRef.current.values()].slice(0, 2);
      const a = localPoint(event.currentTarget, points[0].x, points[0].y);
      const b = localPoint(event.currentTarget, points[1].x, points[1].y);
      const center = midpoint(a, b);
      const gesture = gestureRef.current;
      const k = clamp(
        gesture.startK * (distance(a, b) / gesture.startDistance),
        GRAPH_MIN_ZOOM,
        MAX_ZOOM,
      );
      commitView({
        x: center.x - gesture.worldX * k,
        y: center.y - gesture.worldY * k,
        k,
      });
      return;
    }

    const pointer = [...pointersRef.current.values()][0];
    if (!pointer) return;
    if (gestureRef.current.mode !== 'pan') beginPan(pointer);
    const gesture = gestureRef.current;
    const dx = pointer.x - gesture.startX;
    const dy = pointer.y - gesture.startY;
    if (!dragMovedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    dragMovedRef.current = true;
    commitView({ x: gesture.viewX + dx, y: gesture.viewY + dy, k: viewRef.current.k });
    const now = performance.now();
    historyRef.current.push({ x: pointer.x, y: pointer.y, time: now });
    if (historyRef.current.length > 6) historyRef.current.shift();
  }, [beginPan, beginPinch, commitView]);

  const finishPointer = useCallback((event, cancelled = false) => {
    const wasPan = gestureRef.current.mode === 'pan';
    const pointer = pointersRef.current.get(event.pointerId);
    pointersRef.current.delete(event.pointerId);
    try { pointer?.captureTarget?.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }

    if (pointersRef.current.size >= 2) {
      beginPinch(event.currentTarget);
      return;
    }
    if (pointersRef.current.size === 1) {
      const pointer = [...pointersRef.current.values()][0];
      beginPan(pointer);
      return;
    }

    gestureRef.current = { mode: null };
    setIsInteracting(false);
    if (!cancelled && wasPan && dragMovedRef.current) startMomentum();

    if (!cancelled && event.pointerType === 'touch' && !dragMovedRef.current) {
      const point = localPoint(event.currentTarget, event.clientX, event.clientY);
      const previous = lastTapRef.current;
      const now = performance.now();
      if (previous && now - previous.time < 300 && distance(previous, point) < 24) {
        lastTapRef.current = null;
        onDoubleTap?.(point);
      } else {
        lastTapRef.current = { ...point, time: now };
      }
    }
  }, [beginPan, beginPinch, onDoubleTap, startMomentum]);

  const onPointerUp = useCallback((event) => finishPointer(event, false), [finishPointer]);
  const onPointerCancel = useCallback((event) => finishPointer(event, true), [finishPointer]);
  const onLostPointerCapture = useCallback((event) => {
    if (pointersRef.current.has(event.pointerId)) finishPointer(event, true);
  }, [finishPointer]);

  const zoomAt = useCallback((point, factor, { animated = false } = {}) => {
    const current = viewRef.current;
    const k = clamp(current.k * factor, GRAPH_MIN_ZOOM, MAX_ZOOM);
    const worldX = (point.x - current.x) / current.k;
    const worldY = (point.y - current.y) / current.k;
    const target = { x: point.x - worldX * k, y: point.y - worldY * k, k };
    if (animated) animateTo(target);
    else commitView(target);
  }, [animateTo, commitView]);

  const onWheel = useCallback((event) => {
    event.preventDefault();
    // Keep a pointer drag/pinch as one coherent gesture. Mixing a wheel
    // update into its captured start baseline would cause the next move to jump.
    if (pointersRef.current.size > 0) return;
    cancelAnimation();
    markUserInteraction();
    const point = localPoint(event.currentTarget, event.clientX, event.clientY);
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    const now = performance.now();
    const previousGesture = wheelGestureRef.current;
    const continuingBurst = now - previousGesture.lastTime < 180
      && previousGesture.ctrlKey === event.ctrlKey;
    const mode = event.ctrlKey
      ? 'zoom'
      : continuingBurst && previousGesture.mode
        ? previousGesture.mode
        : event.deltaMode === 0
          && (Math.abs(event.deltaX) > 0.5 || Math.abs(event.deltaY) < 40)
          ? 'pan'
          : 'zoom';
    wheelGestureRef.current = { mode, lastTime: now, ctrlKey: event.ctrlKey };

    if (mode === 'pan') {
      const current = viewRef.current;
      commitView({
        x: current.x - event.deltaX,
        y: current.y - event.deltaY,
        k: current.k,
      });
      return;
    }
    zoomAt(point, Math.exp(-delta * 0.0012));
  }, [cancelAnimation, commitView, markUserInteraction, zoomAt]);

  return {
    view,
    viewRef,
    isInteracting,
    dragMovedRef,
    userInteractedRef,
    interactionVersionRef,
    markUserInteraction,
    commitView,
    animateTo,
    zoomAt,
    cancelAnimation,
    wheelHandler: onWheel,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
    },
  };
}
