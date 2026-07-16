import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * SortableItem — render-prop wrapper around @dnd-kit's `useSortable`.
 *
 * Hides the boilerplate of wiring transforms/listeners to a DOM node so each
 * consumer only renders its own markup. The render fn receives:
 *   { ref, style, attributes, listeners, isDragging, setActivatorNodeRef }
 *
 * `setActivatorNodeRef` is used when only part of the item (e.g. a drag
 * handle icon) should initiate dragging — attach it + `listeners` to that
 * element while attaching `ref` + `style` to the outer item wrapper.
 *
 * Props:
 *   id           — string id used by SortableContext
 *   data         — optional payload (e.g. { type: 'task', groupId }) read on drag
 *   disabled     — bool, skips drag sensors when true (e.g. while inline editing)
 *   children     — render fn taking the kit values
 */
const SortableItem = ({ id, data, disabled = false, children }) => {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, data, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  return children({
    ref: setNodeRef,
    setActivatorNodeRef,
    style,
    attributes,
    listeners,
    isDragging,
  });
};

export default SortableItem;
