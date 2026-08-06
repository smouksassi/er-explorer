/** Drag-and-drop reorder for exposure/endpoint checkbox lists in the Analysis drawer. */

export function mountSortableFieldList(
  container: HTMLElement,
  itemIds: string[],
  selected: Set<string>,
  labelFor: (id: string) => string,
  onChange: (nextOrder: string[], nextSelected: Set<string>) => void
): void {
  container.classList.add("sortable-field-list");
  container.innerHTML = "";
  let dragFromIndex = -1;

  const render = () => {
    container.innerHTML = "";
    itemIds.forEach((id, index) => {
      const li = document.createElement("li");
      li.className = "sortable-field-item";
      li.draggable = true;
      li.dataset.id = id;
      li.dataset.index = String(index);

      const handle = document.createElement("span");
      handle.className = "sortable-drag-handle";
      handle.title = "Drag to reorder";
      handle.textContent = "⋮⋮";
      handle.draggable = false;

      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = id;
      input.checked = selected.has(id);
      input.addEventListener("change", () => {
        const next = new Set(selected);
        if (input.checked) next.add(id);
        else {
          if (next.size <= 1 && next.has(id)) {
            input.checked = true;
            return;
          }
          next.delete(id);
        }
        selected = next;
        onChange([...itemIds], selected);
      });
      label.append(input, document.createTextNode(` ${labelFor(id)}`));
      li.append(handle, label);

      li.addEventListener("dragstart", (ev) => {
        dragFromIndex = index;
        li.classList.add("sortable-dragging");
        if (ev.dataTransfer) {
          ev.dataTransfer.effectAllowed = "move";
          ev.dataTransfer.setData("text/plain", id);
        }
      });
      li.addEventListener("dragend", () => {
        dragFromIndex = -1;
        li.classList.remove("sortable-dragging");
        container.querySelectorAll(".sortable-drop-target").forEach((el) => el.classList.remove("sortable-drop-target"));
      });
      li.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
        li.classList.add("sortable-drop-target");
      });
      li.addEventListener("dragleave", () => li.classList.remove("sortable-drop-target"));
      li.addEventListener("drop", (ev) => {
        ev.preventDefault();
        li.classList.remove("sortable-drop-target");
        const toIndex = index;
        if (dragFromIndex < 0 || dragFromIndex === toIndex) return;
        const next = [...itemIds];
        const [moved] = next.splice(dragFromIndex, 1);
        next.splice(toIndex, 0, moved!);
        itemIds = next;
        onChange(next, selected);
        render();
      });

      container.appendChild(li);
    });
  };

  render();
}
