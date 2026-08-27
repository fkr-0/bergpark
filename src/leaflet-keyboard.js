export function markerKeyboardActivation(action) {
  return ({ originalEvent } = {}) => {
    if (!originalEvent || originalEvent.repeat || !['Enter', ' '].includes(originalEvent.key)) return;
    originalEvent.preventDefault?.();
    originalEvent.stopPropagation?.();
    action();
  };
}
