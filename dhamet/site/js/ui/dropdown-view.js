(function (global) {
  "use strict";

  var active = null;

  function closeActive() {
    if (!active) return;
    try {
      active.menu.hidden = true;
      active.trigger.setAttribute("aria-expanded", "false");
      active.wrapper.classList.remove("is-open");
    } catch (_) {}
    active = null;
  }

  function optionLabel(select) {
    var option = select && select.options ? select.options[select.selectedIndex] : null;
    return option ? String(option.textContent || option.label || option.value || "") : "";
  }

  function positionMenu(instance) {
    if (!instance || instance.menu.hidden) return;
    var rect = instance.trigger.getBoundingClientRect();
    var doc = document.documentElement;
    var viewportWidth = Math.max(doc.clientWidth || 0, global.innerWidth || 0);
    var width = Math.max(rect.width, 150);
    var left = rect.left;
    if (left + width > viewportWidth - 8) left = Math.max(8, viewportWidth - width - 8);
    instance.menu.style.position = "fixed";
    instance.menu.style.left = Math.round(left) + "px";
    instance.menu.style.top = Math.round(rect.bottom + 6) + "px";
    instance.menu.style.width = Math.round(width) + "px";
  }

  function refresh(select) {
    var instance = select && select.__dhametDropdown;
    if (!instance) return;
    var options = Array.from(select.options || []);
    var buttons = Array.from(instance.menu.querySelectorAll("[data-value]"));
    if (buttons.length !== options.length) {
      buildOptions(instance);
      return;
    }
    options.forEach(function (option, index) {
      var button = buttons[index];
      if (!button) return;
      button.dataset.value = String(option.value);
      button.textContent = String(option.textContent || option.label || option.value || "");
      button.disabled = !!option.disabled;
      var selected = String(option.value) === String(select.value);
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
    });
    instance.label.textContent = optionLabel(select);
    var aria = select.getAttribute("aria-label");
    if (aria) instance.trigger.setAttribute("aria-label", aria);
  }

  function buildOptions(instance) {
    var select = instance.select;
    instance.menu.innerHTML = "";
    Array.from(select.options || []).forEach(function (option) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "z-select-option";
      button.dataset.value = String(option.value);
      button.setAttribute("role", "option");
      button.textContent = String(option.textContent || option.label || option.value || "");
      button.disabled = !!option.disabled;
      button.addEventListener("click", function (event) {
        event.preventDefault();
        if (button.disabled) return;
        select.value = button.dataset.value;
        refresh(select);
        closeActive();
        select.dispatchEvent(new Event("change", { bubbles: true }));
        try { instance.trigger.focus(); } catch (_) {}
      });
      instance.menu.appendChild(button);
    });
    refresh(select);
  }

  function enhance(select) {
    if (!select || select.__dhametDropdown) return select && select.__dhametDropdown;

    var wrapper = document.createElement("span");
    wrapper.className = "z-select-dropdown";
    if (select.classList.contains("ai-level-select")) wrapper.classList.add("is-ai-level");

    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "z-select-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    var aria = select.getAttribute("aria-label");
    if (aria) trigger.setAttribute("aria-label", aria);

    var label = document.createElement("span");
    label.className = "z-select-trigger-label";
    var arrow = document.createElement("span");
    arrow.className = "z-select-trigger-arrow";
    arrow.setAttribute("aria-hidden", "true");
    trigger.appendChild(label);
    trigger.appendChild(arrow);

    var menu = document.createElement("div");
    menu.className = "z-select-menu";
    menu.setAttribute("role", "listbox");
    menu.hidden = true;

    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    wrapper.appendChild(trigger);
    document.body.appendChild(menu);
    select.classList.add("z-native-select-hidden");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    var instance = { select: select, wrapper: wrapper, trigger: trigger, label: label, menu: menu };
    select.__dhametDropdown = instance;
    buildOptions(instance);

    trigger.addEventListener("click", function (event) {
      event.preventDefault();
      if (active && active !== instance) closeActive();
      var open = menu.hidden;
      if (!open) {
        closeActive();
        return;
      }
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      wrapper.classList.add("is-open");
      active = instance;
      positionMenu(instance);
    });

    trigger.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (menu.hidden) trigger.click();
        var selected = menu.querySelector(".is-selected:not(:disabled)") || menu.querySelector(".z-select-option:not(:disabled)");
        if (selected) selected.focus();
      } else if (event.key === "Escape") {
        closeActive();
      }
    });

    select.addEventListener("change", function () { refresh(select); });
    return instance;
  }

  document.addEventListener("pointerdown", function (event) {
    if (!active) return;
    if (active.wrapper.contains(event.target) || active.menu.contains(event.target)) return;
    closeActive();
  }, true);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeActive();
  });
  global.addEventListener("resize", function () { if (active) positionMenu(active); });
  global.addEventListener("scroll", function () { if (active) positionMenu(active); }, true);

  function destroy(select) {
    var instance = select && select.__dhametDropdown;
    if (!instance) return;
    if (active === instance) closeActive();
    try { instance.menu.remove(); } catch (_) {}
    try {
      instance.wrapper.parentNode.insertBefore(select, instance.wrapper);
      instance.wrapper.remove();
    } catch (_) {}
    try {
      select.classList.remove("z-native-select-hidden");
      select.removeAttribute("aria-hidden");
      select.tabIndex = 0;
      delete select.__dhametDropdown;
    } catch (_) {}
  }

  global.DhametDropdownView = {
    enhance: enhance,
    refresh: refresh,
    destroy: destroy,
    close: closeActive,
  };
})(typeof window !== "undefined" ? window : globalThis);
