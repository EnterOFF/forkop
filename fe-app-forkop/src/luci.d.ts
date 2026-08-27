// The LuCI runtime, as far as this app reaches into it.
//
// None of these are imported: LuCI hands every module its dependencies through
// the `"require ..."` prologue at the top of the bundle, so inside the bundle
// they are plain globals. This file is what tells TypeScript they exist and
// what shape they have.
//
// The surface is deliberately closed - only the members the app actually uses
// are declared, so a new dependency on LuCI shows up as a type error instead of
// silently working until a LuCI upgrade removes it.

type HtmlTag = keyof HTMLElementTagNameMap;

type HtmlElement<T extends HtmlTag> = HTMLElementTagNameMap[T];

type HtmlAttributes<T extends HtmlTag = 'div'> = Partial<
  Omit<
    HtmlElement<T>,
    | 'style'
    | 'children'
    | 'click'
    | 'keydown'
    | 'disabled'
    | 'placeholder'
    | 'selected'
    | 'spellcheck'
    | 'value'
  > & {
    style?: string | Partial<CSSStyleDeclaration>;
    class?: string;
    'aria-busy'?: string;
    'aria-hidden'?: string;
    'aria-disabled'?: string;
    'aria-expanded'?: string;
    'aria-label'?: string;
    'aria-pressed'?: string;
    'data-latency-code'?: string;
    'data-latency-section'?: string;
    'data-latency-targets'?: string;
    // E() sets whatever it is given with setAttribute, so an attribute keeps its
    // HTML spelling and does not have to belong to the tag it is set on.
    tabindex?: string | number;
    placeholder?: string;
    disabled?: string | boolean | null;
    selected?: string | boolean;
    display?: string;
    role?: string;
    spellcheck?: string | boolean;
    value?: string;
    readonly?: string | boolean;
    autocomplete?: string;
    click?: (event: MouseEvent) => void;
    onclick?: (event: MouseEvent) => void;
    keydown?: (event: KeyboardEvent) => void;
  }
>;

declare global {
  // ---------------------------------------------------------------- uci model
  //
  // The browser-side copy of /etc/config. Reads are synchronous because the
  // whole package is loaded once before a view renders; writes are staged until
  // the page saves.

  interface UciSectionObject {
    '.name': string;
    '.type': string;
    '.anonymous'?: boolean;
    '.index'?: number;
    [option: string]: string | string[] | boolean | number | undefined;
  }

  type UciValue = string | string[] | null;

  const uci: {
    load(packages: string | string[]): Promise<string[]>;
    get(config: string, section: string): UciSectionObject | null;
    get(config: string, section: string, option: string): UciValue;
    get_all(config: string, section: string): UciSectionObject | null;
    set(config: string, section: string, option: string, value: UciValue): void;
    unset(config: string, section: string, option: string): void;
    add(config: string, type: string, name?: string): string;
    remove(config: string, section: string): void;
    sections(config: string, type?: string): UciSectionObject[];
  };

  // ------------------------------------------------------------------ cbi/form
  //
  // The declarative form machinery. A view builds a Map, gives it Sections, and
  // gives each Section its Options; LuCI renders them, validates them and writes
  // the result back into the uci model above.

  // What section.option()/taboption() hands back. LuCI's own members come first;
  // the ones Forkop attaches are merged in from src/forkop/cbi.d.ts.
  interface CBIOption {
    readonly option: string;
    readonly section: CBISection;
    readonly map: CBIMap;

    title?: string;
    description?: string;
    default?: unknown;
    datatype?: string;
    placeholder?: string;
    optional?: boolean;
    rmempty?: boolean;
    retain?: boolean;
    readonly?: boolean;
    password?: boolean;
    modalonly?: boolean;
    editable?: boolean;
    multiple?: boolean;
    forcewrite?: boolean;
    rawhtml?: boolean;
    // A DummyValue renders this instead of the stored value.
    textvalue?: (
      sectionId: string,
      value?: unknown,
    ) => UciValue | Node | undefined;
    width?: string;
    rows?: number;
    wrap?: string;
    inputtitle?: string;
    inputstyle?: string;
    keylist?: string[];
    vallist?: string[];
    // The uci option this field is stored under, when it differs from the name
    // the form knows it by.
    ucioption?: string;
    textarea?: boolean;
    // A MultiValue that also lets the user type a value of their own.
    create?: boolean;
    allowduplicates?: boolean;
    filter?: (sectionId: string, value: string) => boolean;
    // What a tools.widgets device or network picker leaves out of its list.
    noaliases?: boolean;
    nobridges?: boolean;
    noinactive?: boolean;

    // The choices as the rendered widget wants them, and LuCI's own HTML
    // stripper, which a view calls when it puts a title into a message.
    transformChoices(): Record<string, string> | null;
    stripTags(value: unknown): string;

    // Declares a choice on a ListValue/MultiValue/DynamicList.
    value(key: string, label?: unknown): CBIOption;
    // Shows this option only while the named options hold the given values.
    depends(name: string | Record<string, unknown>, value?: unknown): CBIOption;

    // The id of the DOM node this option renders into, for the given section.
    cbid(sectionId: string): string;
    // The stored value, and the one currently in the form.
    // The stored value of the field. A DummyValue may answer with a node
    // instead, which is what it then renders.
    cfgvalue(sectionId: string, value?: unknown): UciValue | Node | undefined;
    formvalue(sectionId: string): UciValue | undefined;
    // The rendered widget, absent until the option is on screen.
    getUIElement(sectionId: string): CBIWidget | null;
    triggerValidation(sectionId: string): void;
    isActive(sectionId: string): boolean;

    // Calls the method this one overrides, the way LuCI's class machinery does.
    super(method: string, args?: unknown): unknown;

    // Hooks a view replaces to change how one option behaves. LuCI defines all
    // of them on the prototype, so they are always there to call or to wrap.
    checkDepends(sectionId: string): boolean;
    load(sectionId: string): unknown;
    write(sectionId: string, value: unknown): void;
    remove(sectionId: string): void;
    parse(sectionId: string): Promise<void> | void;
    validate: (sectionId: string, value: string) => true | string;
    renderWidget(
      sectionId: string,
      optionIndex: string,
      cfgvalue: unknown,
    ): Node | Promise<Node>;
    // LuCI calls this as onchange(ev, section_id, value).
    onchange?: (event: Event, sectionId: string, value: unknown) => void;
    onclick?: (event: Event, ...args: unknown[]) => unknown;
  }

  // A Section owns Options; a GridSection also owns the table that lists them.
  interface CBISection {
    readonly config: string;
    readonly sectiontype: string;
    map: CBIMap;

    anonymous?: boolean;
    addremove?: boolean;
    sortable?: boolean;
    tabbed?: boolean;
    rowcolors?: boolean;
    nodescriptions?: boolean;
    hidetitle?: boolean;
    // The package a section reads and writes, when it is not the map's own -
    // a JSONMap dialog names its own here.
    uciconfig?: string;
    load?(): Promise<unknown>;
    modaltitle?: string | ((sectionId: string) => string);
    sectiontitle?: string | ((sectionId: string) => UciValue);
    // The title of one of the section's own controls, by key.
    titleFn(key: string): string;
    addbtntitle?: string | (() => string);

    option(widget: CBIWidgetClass, name: string, ...rest: unknown[]): CBIOption;
    taboption(
      tab: string,
      widget: CBIWidgetClass,
      name: string,
      ...rest: unknown[]
    ): CBIOption;
    tab(name: string, title: string, description?: string): void;
    cfgsections(): string[];
    createId?(name?: string): string;
    filter?(sectionId: string): boolean;
    renderContents(...args: unknown[]): Node | Promise<Node>;
    renderSectionAdd?(...args: unknown[]): Node;
    renderRowActions?(sectionId: string, label?: string): Node;
    // The section dialog: the one LuCI is showing, the one it showed before,
    // and the call that opens a new one.
    getActiveModalMap(): Node | null;
    getPreviousModalMap(): Node | null;
    renderMoreOptionsModal(sectionId: string, event?: Event): Promise<void>;
    handleAdd?(event: Event, name?: string): unknown;
    handleRemove?(sectionId: string, event: Event): unknown;
    handleModalSave?(...args: unknown[]): Promise<unknown>;
    children: CBIOption[];
  }

  // A Map is a whole form: it is bound to one uci package, or - as JSONMap - to
  // a plain object, which is how the dialogs here edit values that are not in
  // uci yet.
  // Where a Map keeps the values it is editing. For a uci Map that is the uci
  // model; for a JSONMap it is the plain object the dialog was opened on, and
  // both answer the same four-argument shape.
  interface CBIMapData {
    // Two arguments read a whole section, three read one of its options.
    get(config: string, section: string): UciSectionObject | null;
    get(config: string, section: string, option: string): unknown;
    // The uci model behind the map: what is stored and what is staged.
    readonly state: {
      values: Record<string, Record<string, UciSectionObject>>;
      changes?: Record<string, unknown>;
      creates?: Record<string, unknown>;
      deletes?: Record<string, unknown>;
    };
    set(config: string, section: string, option: string, value: unknown): void;
    unset(config: string, section: string, option: string): void;
    add(config: string, type: string, name?: string): string;
    remove(config: string, section: string): void;
    sections(config: string, type?: string): UciSectionObject[];
  }

  interface CBIMap {
    readonly config: string;
    readonly data: CBIMapData;
    readonly?: boolean;
    // The sections are shown as tabs rather than one under the other.
    tabbed?: boolean;

    section(
      widget: CBISectionClass,
      type: string,
      ...rest: unknown[]
    ): CBISection;
    lookupOption(name: string, sectionId: string): [CBIOption, string] | null;
    // The rendered node of one option, found through the map that owns it.
    findElement(
      selector: string | Record<string, string>,
      value?: string,
    ): HTMLElement | null;
    // Re-evaluates every depends() in the form, which is how a view shows or
    // hides an option after changing something the option depends on.
    checkDepends(): boolean;
    load(): Promise<void>;
    render(): Promise<HTMLElement>;
    save(cb?: () => void, silent?: boolean): Promise<void>;
    parse(): Promise<void>;
    reset(): Promise<Node>;
    children: CBISection[];
  }

  // Every LuCI class is built by extend() rather than by `class`, and the views
  // subclass the widgets this way too.
  // extend() carries ThisType so that inside a member `this` is the instance
  // plus whatever the subclass added; without it every `this.` in an override is
  // untyped. The prototype stays open because it is how an override reaches the
  // method it replaced, and LuCI's own methods are not modelled here.
  interface CBIWidgetClass {
    new (...args: unknown[]): CBIOption;
    extend<M extends object>(
      members: M & ThisType<CBIOption & M>,
    ): CBIWidgetClass;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prototype: Record<string, any>;
  }

  interface CBISectionClass {
    new (...args: unknown[]): CBISection;
    extend<M extends object>(
      members: M & ThisType<CBISection & M>,
    ): CBISectionClass;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prototype: Record<string, any>;
  }

  const form: {
    Map: { new (config: string, title?: string, description?: string): CBIMap };
    JSONMap: { new (data: Record<string, unknown>, title?: string): CBIMap };

    TypedSection: CBISectionClass;
    NamedSection: CBISectionClass;
    GridSection: CBISectionClass;
    TableSection: CBISectionClass;

    Value: CBIWidgetClass;
    Flag: CBIWidgetClass;
    ListValue: CBIWidgetClass;
    MultiValue: CBIWidgetClass;
    DynamicList: CBIWidgetClass;
    TextValue: CBIWidgetClass;
    DummyValue: CBIWidgetClass;
    Button: CBIWidgetClass;
  };

  // -------------------------------------------------------------------- ui
  //
  // The widget layer under cbi/form: what a rendered option actually is, plus
  // the modal and notification helpers a view calls directly.

  // What a ui widget was constructed with.
  interface CBIWidgetOptions {
    id?: string;
    optional?: boolean;
    datatype?: string;
    placeholder?: string;
    disabled?: boolean | string | null;
    multiple?: boolean;
    sort?: string[];
    validate?: (value: string) => true | string;
  }

  interface CBIWidget {
    node: HTMLElement;
    getValue(): string | string[] | null;
    setValue(value: string | string[] | null): void;
    getName(): string;
    isValid(): boolean;
    triggerValidation(): boolean;
    render(): HTMLElement;
    // Dropdown-backed widgets carry the list the user picks from.
    choices?: Record<string, unknown>;
    // What the widget was built with. Forkop adds to this - see
    // src/forkop/cbi/cbi.d.ts.
    options: CBIWidgetOptions;
    clearChoices(reset?: boolean): void;
    addChoices(values: string[], labels: Record<string, unknown>): void;
    // A DynamicList adds one entry, and tells the form its value moved.
    addItem(
      node: HTMLElement,
      value: string,
      text?: unknown,
      flash?: boolean,
    ): void;
    dispatchCbiDynlistChange(
      node: HTMLElement,
      add?: unknown,
      remove?: unknown,
    ): void;
  }

  interface CBIWidgetConstructor {
    new (value?: unknown, ...args: unknown[]): CBIWidget;
    extend<M extends object>(
      members: M & ThisType<CBIWidget & M>,
    ): CBIWidgetConstructor;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prototype: Record<string, any>;
  }

  const ui: {
    showModal(
      title: string | null,
      children: Node | Node[],
      ...classes: string[]
    ): HTMLElement;
    hideModal(): void;
    addNotification(
      title: string | null,
      children: Node | Node[],
      ...classes: string[]
    ): HTMLElement;
    // Wraps a method so LuCI can show it as busy while it runs.
    createHandlerFn(
      context: object,
      method: string | ((...args: never[]) => unknown),
      ...args: unknown[]
    ): (event: Event) => Promise<unknown>;

    Dropdown: CBIWidgetConstructor;
    DynamicList: CBIWidgetConstructor;
    Textarea: CBIWidgetConstructor;
    Textfield: CBIWidgetConstructor;
    Select: CBIWidgetConstructor;
  };

  // ------------------------------------------------------------------- dom
  const dom: {
    append(node: Node, children: unknown): Node | null;
    content(node: Node, children: unknown): Node | null;
    // LuCI stores a widget instance on the node it rendered; this walks up to it.
    findClassInstance(
      node: Node | null,
    ): CBIWidget | CBIMap | CBIModalMap | null;
    parse(html: string): DocumentFragment;
  };

  // --------------------------------------------------------------- baseclass
  //
  // What a LuCI module returns. The bundle's own return is written by the build,
  // so this is only here for the modules that still call it directly.
  const baseclass: {
    extend<T extends object>(members: T): T;
  };

  // -------------------------------------------------------------------- fs
  const fs: {
    read(path: string): Promise<string>;
    write(path: string, data: string): Promise<void>;
    remove(path: string): Promise<void>;
    exec(
      command: string,
      args?: string[],
      env?: Record<string, string>,
    ): Promise<{
      stdout: string;
      stderr: string;
      code?: number;
    }>;
  };

  // ------------------------------------------------------------------- rpc
  const rpc: {
    declare: (options: {
      object: string;
      method: string;
      params?: string[];
      expect?: Record<string, unknown>;
    }) => (...args: unknown[]) => Promise<unknown>;
  };

  // --------------------------------------------------------------- network
  interface NetworkDevice {
    getName(): string;
    getType(): string;
    getI18n(): string;
    isUp(): boolean;
  }

  const network: {
    getDevices(): Promise<NetworkDevice[]>;
  };

  // -------------------------------------------------- tools.widgets (luci-base)
  const widgets: {
    DeviceSelect: CBIWidgetClass;
    NetworkSelect: CBIWidgetClass;
  };

  // --------------------------------------------------------------- luci.js
  // E(tag, attributes, children), or E(children) for a bare fragment holder.
  const E: {
    <T extends HtmlTag>(
      type: T,
      attr?: HtmlAttributes<T> | null,
      children?: (Node | string)[] | Node | string,
    ): HTMLElementTagNameMap[T];
    (children: (Node | string)[]): HTMLElement;
  };

  const _: (key: string, context?: string) => string;

  const L: {
    env?: {
      rpctimeout?: number;
    };
    // Wraps anything into an array: LuCI stores a one-element uci list as a
    // bare string, so every list read goes through this.
    toArray<T>(value: T | T[] | null | undefined): T[];
    bind<T extends (...args: never[]) => unknown>(
      fn: T,
      self: unknown,
      ...args: unknown[]
    ): T;
    resource(...parts: string[]): string;
    error(type: string, message?: string): never;
  };

  // luci.js installs this on String.prototype for %s/%d substitution.
  interface String {
    format(...args: unknown[]): string;
  }
}

export {};
