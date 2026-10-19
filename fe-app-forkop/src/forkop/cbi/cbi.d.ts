// What Forkop hangs off a CBI option on top of LuCI's own members.
//
// The widgets in this directory are generic: they never name a concrete kind of
// item, they read their behaviour off the option they were given. This is the
// shape of what they read.
//
// These merge into the interfaces declared in src/luci.d.ts.

import type { Annotation } from './annotations';

declare global {
  // One value picked out of a text field that holds a list, with where it sits
  // in the text so the overlay can underline it.
  interface TextToken {
    value: string;
    start: number;
    end: number;
  }

  // What a text field's analyzer answers: whether the value will do, what to say
  // when it will not, and the spans to mark.
  interface TextAnalysis {
    valid: boolean;
    message?: string;
    annotations: Annotation[];
  }

  type TextAnalyzer = (value: string) => TextAnalysis;

  // A single entry of such a list, checked on its own.
  type TextItemValidator = (value: string) => {
    valid: boolean;
    message?: string;
  };

  interface TextListAnalysisOptions {
    duplicateMessage?: string;
    // Two spellings that mean the same entry - a domain with and without its
    // leading dot, say - so the second one is caught as a duplicate.
    normalizeDuplicateValue?: (value: string) => string;
  }

  // The overlay a textarea carries once it shows validation marks, kept on the
  // field itself so configuring the same field again replaces its analyzer
  // instead of stacking a second overlay on top.
  interface AnnotatedTextareaController {
    analyzer: TextAnalyzer;
    textarea: HTMLTextAreaElement;
    wrapper: HTMLElement;
    overlay: HTMLElement;
    resizeObserver?: ResizeObserver;
    update(): void;
  }

  interface HTMLTextAreaElement {
    __forkopAnnotatedTextareaController?: AnnotatedTextareaController;
  }

  // The settings of one child item while a dialog is editing them: option name
  // to value, before anything reaches uci.
  type ChildSettings = Record<string, unknown>;

  // What LuCI hands an option's validate(): the section being edited and the
  // value the user typed. It answers true, or the reason it refuses.
  type OptionValidator = (sectionId: string, value: string) => string | true;

  // One entry of a list of choices: the value that gets stored, and the text
  // shown for it when the two differ.
  type ChoiceEntry = string | { value: string; label?: unknown };

  // How a dynamic list turns its entries into uci sections of their own. The
  // option carries the same facts under longer names; this is the shape they
  // travel in once the widget hands them to the child item helpers.
  interface ChildItemOptions {
    typeName?: string;
    valueOption?: string;
    ownerOption?: string;
    createId?: (inputValue?: string, sectionId?: string) => string;
    // Either the whole default set, or one built from the value the user typed.
    // A single default may itself be a function, which is how a child gets an id
    // or a name derived from its owner.
    defaults?:
      | Record<string, unknown>
      | ((inputValue: string, existing: boolean) => Record<string, unknown>);
    // The settings of an entry the user added but has not saved, so a child
    // created now starts from what the dialog already holds. Asked only for a
    // child that has just been created; an entry that was already a section
    // carries its settings in that section.
    stagedSettings?: ((value: unknown) => ChildSettings | null) | null;
  }

  interface CBIOption {
    // ------------------------------------------------ the child item list
    //
    // A dynamic list whose entries stand for uci sections of their own. The
    // option says what kind they are and how to address them; the widget does
    // the rest without ever naming a kind.

    // The uci section type each entry stands for, and the option of that section
    // holding the text the list shows.
    childType?: string;
    childValueOption?: string;
    // The option on the child that points back at its owner - "section" for a
    // section's children, "group" for the levels of a fallback group.
    ownerOption?: string;
    // The section a new child belongs to, when it is not the one being edited.
    childOwnerId?: (sectionId: string) => string;
    // A child item of this list has a list of its own, and removing the item
    // has to take what it holds with it.
    removeNestedChildItems?: (itemId: string) => void;
    // The section the list itself belongs to, for a list rendered inside a
    // dialog that is editing a child of another section.
    parentSectionId?: ((sectionId: string) => string) | string;
    // What a freshly added child starts with.
    childDefaults?:
      | ChildSettings
      | ((inputValue: string, existing: boolean) => ChildSettings);
    // The id a new child section is created under.
    createId?: (inputValue?: string, sectionId?: string) => string;
    // Every entry is a child section from the moment it is added, where other
    // lists stage an entry until the section is saved: a tunnel's dialog writes
    // the tunnel when it closes, and a link typed into its list is a section as
    // soon as it is added.
    entriesAreSections?: boolean;
    // Where the per-entry settings of this list are stored on the owning section.
    // Entries are added through a dialog rather than by typing into the list.
    buttonAdd?: boolean;
    // Left out of the table load: a column that renders from something other
    // than a stored value has nothing to load.
    disable?: boolean;

    // Whether an entry has a settings dialog behind it, and what the dialog is.
    hasItemSettings?: (sectionId: string, value: unknown) => boolean;
    renderItemSettingsModal?: (
      sectionId: string,
      itemValue: string,
      option: CBIOption,
      widget: CBIWidget,
      item: Element | null,
      context?: ChildItemModalContext,
    ) => unknown;
    // The label an entry shows, given the text the list would have shown. It is
    // a node rather than a string when the label carries an icon of its own.
    renderListItemLabel?: (
      sectionId: string,
      itemId: string,
      text?: string | null,
    ) => string | Node;
    // The text an entry shows and is looked up by: what its child section
    // stores, or - for an entry the dialog has filled in but not written yet -
    // the name that dialog is holding.
    inputValueForItem?: (sectionId: string, value: unknown) => string;
    // The caption of the button that adds an entry.
    addButtonLabel?: string | ((sectionId: string) => string);
    // Refused before the dialog saves, so a half-filled entry cannot be stored.
    validateItemsOnSave?: (
      sectionId: string,
      values: unknown,
      option: CBIOption,
      formSectionId?: string,
    ) => true | string;
    // Run once the entries have been turned into real sections.
    afterMaterializeChildItems?: (sectionId: string, itemIds: string[]) => void;
    // Run whenever the list changes, while the dialog is still open, with the
    // entries the list holds after the change.
    onListChange?: (sectionId: string, values: string[]) => void;

    // An entry the user added but has not saved yet exists only here, keyed by
    // the text it shows. Two lists that edit the same children - the section
    // dialog and the one inside it - share a store under this key.
    pendingChildSettings?: Record<string, Record<string, ChildSettings>>;
    sharedPendingSettingsKey?: string;
    stagedChildSettings?: (
      sectionId: string,
      value: unknown,
    ) => ChildSettings | null;
    clearStagedChildSettings?: (sectionId: string) => void;
    childItemOptions?: (ownerId: string) => ChildItemOptions;
    createTypedItem?: (sectionId: string, inputValue: string) => string;

    // The rendered list nodes, by section, for a list whose choices are refreshed
    // while the dialog is open.
    liveDynamicListNodes?: Map<string, HTMLElement>;

    // ------------------------------------------------ local device picker
    //
    onDeviceWidgetReady?: (sectionId: string, widget: CBIWidget) => void;
    onDeviceListChange?: (
      sectionId: string,
      value: string | string[] | null,
    ) => void;
    // The devices a network-interface option offers, and the device each
    // interface name resolves to.
    devices?: NetworkDevice[];
    interfaceDeviceMap?: Record<string, NetworkDevice>;
  }

  // What the list tells the dialog about the entry it was opened from: whether
  // it is being added rather than edited, and which sections it belongs to.
  interface ChildItemModalContext {
    adding?: boolean;
    parentSectionId?: string;
    ownerId?: string;
    [key: string]: unknown;
  }

  // What a dialog editing one child item is given: how to reach the section it
  // belongs to, the text the list shows for it, and the list itself.
  interface ChildItemDialogContext {
    parentSectionId: (itemId?: string) => string;
    ownerId: () => string;
    itemValue: () => string;
    listOption: CBIOption;
    validateName?: ChildItemNameValidator;
  }

  // Checks the name a child item is being given. It is handed only the name:
  // the list and the entry it belongs to are bound in when the dialog opens, so
  // the same check works for an entry that has no section yet.
  type ChildItemNameValidator = (value: unknown) => true | string;

  // A settings dialog for one child item, as the generic opener needs it: what
  // kind of section it edits, which of its options the dialog writes, and the
  // options themselves.
  interface ChildItemDialog {
    typeName: string;
    // Absent for a child whose entry is addressed by its section id alone.
    valueOption?: string;
    ownerOption?: string;
    keys: string[];
    defaults?:
      | ChildSettings
      | ((inputValue: string, existing: boolean) => ChildSettings);
    title: (inputValue: string) => string;
    addOptions: (section: CBISection, context: ChildItemDialogContext) => void;
    validateName?: ChildItemNameValidator;
    afterSave?: (
      itemId: string,
      inputValue: string,
      settings: ChildSettings,
      existing: boolean,
    ) => void;
    // The list entry the dialog was opened from, so a rename can follow it.
    itemNode?: Element | null;
    singleField?: boolean;
    saveLabel?: string;
  }

  // How the stacked dialog frame itself is shown.
  interface StackedModalOptions {
    singleField?: boolean;
    saveLabel?: string;
    // A second way to save, beside the save button: it is handed the save and
    // decides when to run it.
    secondaryAction?: {
      label: string;
      icon?: () => SVGSVGElement;
      run: (save: () => Promise<unknown>) => void;
    };
  }

  // One peer of a WireGuard-style endpoint, as it travels through a pasted
  // configuration or a sing-box outbound document.
  interface WireGuardPeerObject {
    address?: unknown;
    port?: unknown;
    public_key?: unknown;
    pre_shared_key?: unknown;
    allowed_ips?: unknown;
    persistent_keepalive_interval?: unknown;
  }

  // The fields of the tunnel dialog an imported configuration is poured into.
  interface ImportedTunnelFields {
    tunnelId: string;
    type: CBIOption;
    amneziaEnabled: CBIOption;
    address: CBIOption;
    privateKey: CBIOption;
    listenPort: CBIOption;
    mtu: CBIOption;
    peers: CBIOption;
    amnezia: Record<string, CBIOption>;
  }

  interface CBISection {
    // The header rows of the subscription headers dialog are numbered as they
    // are added, so a removed row never gives its number back.
    nextHeaderRowIndex?: number;
  }

  // What makes the dynamic list generic: it asks its own options what an entry
  // is called, whether it has settings behind it and what opens them, instead of
  // knowing any of that itself.
  interface CBIWidgetOptions {
    addButtonLabel?: string;
    // Whether a value already in the list means the same thing as this one - a
    // child item is addressed both by the id of its section and by the name it
    // shows, and adding it twice under two spellings would make two of it.
    hasEquivalentValue?: (value: string, node: HTMLElement) => boolean;
    itemLabel?: (value: string, text?: string | null) => string | Node;
    hasSettings?: (value: string) => boolean;
    // The value an entry typed into the list is added under, for a list whose
    // entries are sections: the id of the section it becomes.
    createItem?: ((inputValue: string) => string) | null;
    settingsHandler?: (
      value: string,
      item: Element | null,
      widget: CBIWidget,
      context: { adding?: boolean },
    ) => void;
  }

  // The map inside an open section dialog. LuCI builds it for the one section
  // being edited and overwrites the section() factory with that section's id,
  // so a dialog reads the id it is editing off the map itself.
  interface CBIModalMap extends Omit<CBIMap, 'section'> {
    section: string;
  }

  interface CBIMap {
    // The section a dialog was opened to create, so closing without saving can
    // take it away again.
    addedSection?: string;
  }

  interface CBIWidget {
    // A list whose entries carry a settings button keeps the observer that holds
    // each button to the height of the row beside it.
    settingsButtonResizeObserver?: ResizeObserver | null;
  }

  // The settings button of a list entry is stashed on the entry, so that either
  // one can be found from the other while the list is being reordered.
  interface Element {
    fkpDynamicListSettingsButton?: HTMLElement;
  }
}

export {};
