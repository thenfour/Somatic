
// todo:
// - arrow keys to navigate items
// - enter/space to activate
// - esc to close menu
// - return focus to trigger on close

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ShortcutManagerProvider, useShortcutManager } from '../../keyb/KeyboardShortcutManager';
import { CharMap } from '../../utils/utils';
import { useFocusHistory } from '../basic/restoreFocus';
import './DesktopMenu.css';
import { gMenuActionRegistry, MenuActionId } from './DesktopMenuActions';

const MENU_PORTAL_ID = 'desktop-menu-root';

type MenuPlacement = 'bottom-start' | 'right-start';

// Context for tracking menu capture state across all top-level menus
type MenuCaptureContextValue = {
    isCaptured: boolean;
    activeMenuId: string | null;
    setActiveMenu: (menuId: string | null) => void;
    registerTopLevelMenu: (menuId: string) => () => void;
    getAdjacentTopLevelMenuId: (menuId: string, direction: -1 | 1) => string | null;
};

const MenuCaptureContext = createContext<MenuCaptureContextValue | null>(null);

const useMenuCapture = () => {
    return useContext(MenuCaptureContext);
};

type MenuStateProps = {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
};

type InternalMenuProviderProps = MenuStateProps & {
    children: ReactNode;
    placement: MenuPlacement;
    parentCloseTree?: () => void;
    level?: number;
    rootId?: string;
    menuId?: string;
};

type MenuContextValue = {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    toggle: () => void;
    closeTree: () => void;
    triggerRef: React.MutableRefObject<HTMLElement | null>;
    contentRef: React.MutableRefObject<HTMLDivElement | null>;
    placement: MenuPlacement;
    level: number;
    rootId: string;
    menuId?: string;
};

const MenuContext = createContext<MenuContextValue | null>(null);

const useMenuContext = (component: string): MenuContextValue => {
    const ctx = useContext(MenuContext);
    if (!ctx) {
        throw new Error(`${component} must be used within <DesktopMenu.Root> or <DesktopMenu.Sub>.`);
    }
    return ctx;
};

const InternalMenuProvider: React.FC<InternalMenuProviderProps> = ({
    children,
    placement,
    parentCloseTree,
    level = 0,
    open,
    defaultOpen,
    onOpenChange,
    rootId,
    menuId,
}) => {
    const generatedRootId = useId();
    const resolvedRootId = level === 0 ? (rootId ?? generatedRootId) : (rootId ?? generatedRootId);

    const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
    const isControlled = typeof open === 'boolean';
    const actualOpen = isControlled ? open : internalOpen;

    const updateOpen = useCallback((next: boolean) => {
        if (!isControlled) {
            setInternalOpen(next);
        }
        onOpenChange?.(next);
    }, [isControlled, onOpenChange]);

    const triggerRef = useRef<HTMLElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);

    const openMenu = useCallback(() => updateOpen(true), [updateOpen]);
    const closeMenu = useCallback(() => updateOpen(false), [updateOpen]);
    const toggleMenu = useCallback(() => updateOpen(!actualOpen), [actualOpen, updateOpen]);
    const closeTree = useCallback(() => {
        closeMenu();
        parentCloseTree?.();
    }, [closeMenu, parentCloseTree]);

    const value = useMemo<MenuContextValue>(() => ({
        isOpen: actualOpen,
        open: openMenu,
        close: closeMenu,
        toggle: toggleMenu,
        closeTree,
        triggerRef,
        contentRef,
        placement,
        level,
        rootId: resolvedRootId,
        menuId,
    }), [actualOpen, closeMenu, closeTree, level, menuId, openMenu, placement, resolvedRootId, toggleMenu]);

    return (
        <MenuContext.Provider value={value}>
            {children}
        </MenuContext.Provider>
    );
};

const ensurePortalHost = () => {
    let portal = document.getElementById(MENU_PORTAL_ID);
    if (!portal) {
        portal = document.createElement('div');
        portal.id = MENU_PORTAL_ID;
        document.body.appendChild(portal);
    }
    return portal;
};

const composeRefs = <T,>(...refs: Array<React.Ref<T> | undefined>) => (node: T | null) => {
    refs.forEach((ref) => {
        if (!ref) return;
        if (typeof ref === 'function') {
            ref(node);
        } else {
            (ref as React.MutableRefObject<T | null>).current = node;
        }
    });
};

const isFocusableItem = (node: Element | null) => {
    if (!node) return false;
    return node.getAttribute('role') === 'menuitem' && node.getAttribute('aria-disabled') !== 'true';
};

const focusFirstItem = (container: HTMLElement | null): boolean => {
    if (!container) return false;
    const candidates = Array.from(container.querySelectorAll('[data-menu-item="true"]')) as HTMLElement[];
    for (const candidate of candidates) {
        if (isFocusableItem(candidate)) {
            candidate.focus();
            return true;
        }
    }
    return false;
};

const getMenuPosition = (placement: MenuPlacement, trigger: HTMLElement | null, menuContent: HTMLElement | null) => {
    if (!trigger) return { top: 0, left: 0, minWidth: undefined as number | undefined };
    const rect = trigger.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Estimate menu dimensions (will be refined once rendered)
    const menuHeight = menuContent?.offsetHeight ?? 300; // Default estimate
    const menuWidth = menuContent?.offsetWidth ?? 200; // Default estimate

    if (placement === 'right-start') {
        let top = rect.top;
        let left = rect.right;

        // Adjust horizontal position if menu would overflow right edge
        if (left + menuWidth > viewportWidth) {
            left = rect.left - menuWidth;
        }

        // Adjust vertical position if menu would overflow bottom
        if (top + menuHeight > viewportHeight) {
            top = Math.max(8, viewportHeight - menuHeight - 8);
        }

        return {
            top,
            left,
            minWidth: undefined,
        };
    }

    // bottom-start placement
    let top = rect.bottom;
    let left = rect.left;

    // Adjust vertical position if menu would overflow bottom
    if (top + menuHeight > viewportHeight) {
        // Try to position above the trigger instead
        const topPosition = rect.top - menuHeight;
        if (topPosition >= 8) {
            top = topPosition;
        } else {
            // Not enough room above either, position at top with padding
            top = Math.max(8, viewportHeight - menuHeight - 8);
        }
    }

    // Adjust horizontal position if menu would overflow right edge
    if (left + menuWidth > viewportWidth) {
        left = Math.max(8, viewportWidth - menuWidth - 8);
    }

    return {
        top,
        left,
        minWidth: rect.width,
    };
};

type MenuRootProps = MenuStateProps & {
    children: ReactNode;
};

const MenuRoot: React.FC<MenuRootProps> = ({ children, open, defaultOpen, onOpenChange, ...rest }) => {
    const capture = useMenuCapture();
    const focusHistory = useFocusHistory();
    const focusBookmarkRef = useRef<{ restore: () => void } | null>(null);
    const menuId = useId();
    const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
    const isControlled = typeof open === 'boolean';
    const actualOpen = isControlled ? open : internalOpen;

    useEffect(() => {
        if (!capture?.registerTopLevelMenu) return;
        return capture.registerTopLevelMenu(menuId);
    }, [capture?.registerTopLevelMenu, menuId]);

    // Standalone menus (not within a <DesktopMenu.Bar>) should restore focus when they close.
    // Menubar capture is handled at the bar level so switching between top-level menus does not restore focus.
    useEffect(() => {
        if (capture) return;

        if (actualOpen) {
            focusBookmarkRef.current = focusHistory.capturePrevious();
            return;
        }

        focusBookmarkRef.current?.restore();
        focusBookmarkRef.current = null;
    }, [actualOpen, capture, focusHistory]);

    // Auto-close when another menu becomes active
    useEffect(() => {
        if (capture && actualOpen && capture.activeMenuId !== menuId) {
            if (!isControlled) {
                setInternalOpen(false);
            }
            onOpenChange?.(false);
        }
    }, [capture, actualOpen, menuId, isControlled, onOpenChange]);

    // Auto-open when capture switches to this menu (keyboard cycling between top-level menus)
    useEffect(() => {
        if (!capture) return;
        if (capture.activeMenuId !== menuId) return;
        if (actualOpen) return;

        if (!isControlled) {
            setInternalOpen(true);
        }
        onOpenChange?.(true);
    }, [actualOpen, capture, isControlled, menuId, onOpenChange]);

    // Notify capture context when this menu opens/closes
    const handleOpenChange = useCallback((isOpen: boolean) => {
        if (!isControlled) {
            setInternalOpen(isOpen);
        }
        if (capture) {
            capture.setActiveMenu(isOpen ? menuId : null);
        }
        onOpenChange?.(isOpen);
    }, [capture, menuId, isControlled, onOpenChange]);

    return (
        <InternalMenuProvider
            placement="bottom-start"
            menuId={menuId}
            open={isControlled ? open : internalOpen}
            defaultOpen={undefined}
            onOpenChange={handleOpenChange}
            {...rest}
        >
            {children}
        </InternalMenuProvider>
    );
};

type MenuSubProps = MenuStateProps & {
    children: ReactNode;
};

const MenuSub: React.FC<MenuSubProps> = ({ children, ...stateProps }) => {
    const parentCtx = useMenuContext('DesktopMenu.Sub');
    return (
        <InternalMenuProvider
            placement="right-start"
            parentCloseTree={parentCtx.closeTree}
            level={parentCtx.level + 1}
            rootId={parentCtx.rootId}
            menuId={parentCtx.menuId}
            {...stateProps}
        >
            {children}
        </InternalMenuProvider>
    );
};

type MenuTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    caret?: boolean;
};

const MenuTrigger = React.forwardRef<HTMLButtonElement, MenuTriggerProps>(({ caret = true, className = '', children, onClick, ...rest }, forwardedRef) => {
    const ctx = useMenuContext('DesktopMenu.Trigger');
    const capture = useMenuCapture();
    const [isHovered, setIsHovered] = useState(false);
    const combinedRef = composeRefs<HTMLButtonElement>(forwardedRef, (node) => { ctx.triggerRef.current = node; });

    const handleClick: React.MouseEventHandler<HTMLButtonElement> = (event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        ctx.toggle();
    };

    const handleMouseEnter: React.MouseEventHandler<HTMLButtonElement> = () => {
        setIsHovered(true);
        // If capture is active (any menu is open) and this menu isn't already open,
        // open this menu automatically on hover
        if (capture?.isCaptured && !ctx.isOpen && ctx.level === 0) {
            ctx.open();
        }
    };

    const handleMouseLeave: React.MouseEventHandler<HTMLButtonElement> = () => {
        setIsHovered(false);
    };

    const classes = ['desktop-menu-trigger'];
    if (ctx.isOpen) classes.push('desktop-menu-trigger--open');
    if (isHovered && capture?.isCaptured) classes.push('desktop-menu-trigger--hover-captured');
    if (className) classes.push(className);

    return (
        <button
            {...rest}
            ref={combinedRef}
            className={classes.join(' ')}
            aria-haspopup="menu"
            aria-expanded={ctx.isOpen}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <span className="desktop-menu-trigger__label">{children}</span>
            {caret && <span className="desktop-menu-trigger__caret">{CharMap.DownTriangle}</span>}
        </button>
    );
});
MenuTrigger.displayName = 'DesktopMenuTrigger';

type MenuContentProps = {
    children: ReactNode;
    className?: string;
    minWidth?: number | string;
    style?: CSSProperties;
    autoFocus?: boolean;
};

type MenuContentBodyProps = {
    ctx: MenuContextValue;
    classes: string[];
    contentStyle: CSSProperties;
    combinedRef: React.Ref<HTMLDivElement>;
    children: ReactNode;
};

const MenuContentBody: React.FC<MenuContentBodyProps> = ({ ctx, classes, contentStyle, combinedRef, children }) => {
    const mgr = useShortcutManager<MenuActionId>();
    const capture = useMenuCapture();

    const getContainer = useCallback(() => ctx.contentRef.current, [ctx.contentRef]);

    const getFocusableItems = useCallback((): HTMLElement[] => {
        const container = getContainer();
        if (!container) return [];
        const nodes = Array.from(container.querySelectorAll('[data-menu-item="true"]')) as HTMLElement[];
        return nodes.filter(n => isFocusableItem(n));
    }, [getContainer]);

    const getFocusedIndex = useCallback((items: HTMLElement[]): number => {
        const container = getContainer();
        if (!container) return -1;
        const active = document.activeElement as HTMLElement | null;
        if (!active) return -1;
        if (!container.contains(active)) return -1;
        return items.findIndex(it => it === active);
    }, [getContainer]);

    const focusItemByDelta = useCallback((delta: -1 | 1) => {
        const items = getFocusableItems();
        if (!items.length) return;

        const currentIndex = getFocusedIndex(items);
        const startIndex = currentIndex >= 0 ? currentIndex : (delta === 1 ? -1 : 0);
        const nextIndex = (startIndex + delta + items.length) % items.length;
        const next = items[nextIndex];
        next.focus();
        next.scrollIntoView({ block: 'nearest' });
    }, [getFocusableItems, getFocusedIndex]);

    const getFocusedItem = useCallback((): HTMLElement | null => {
        const container = getContainer();
        if (!container) return null;
        const active = document.activeElement as HTMLElement | null;
        if (active && container.contains(active) && isFocusableItem(active)) return active;
        const items = getFocusableItems();
        return items[0] ?? null;
    }, [getContainer, getFocusableItems]);

    const openFocusedSubmenuIfPresent = useCallback(() => {
        const focused = getFocusedItem();
        if (!focused) return false;
        const isSubmenuTrigger = focused.getAttribute('aria-haspopup') === 'menu';
        if (!isSubmenuTrigger) return false;

        const isExpanded = focused.getAttribute('aria-expanded') === 'true';
        if (!isExpanded) {
            focused.click();
        }
        // Submenu content auto-focuses its first item on open.
        return true;
    }, [getFocusedItem]);

    const activateFocusedItem = useCallback(() => {
        const focused = getFocusedItem();
        if (!focused) return;
        if (focused.getAttribute('aria-haspopup') === 'menu') {
            openFocusedSubmenuIfPresent();
            return;
        }
        focused.click();
    }, [getFocusedItem, openFocusedSubmenuIfPresent]);

    const openSubmenuOrNextMenu = useCallback(() => {
        if (openFocusedSubmenuIfPresent()) return;

        if (capture?.isCaptured && ctx.menuId) {
            const nextId = capture.getAdjacentTopLevelMenuId(ctx.menuId, 1);
            if (nextId) {
                capture.setActiveMenu(nextId);
            }
        }
    }, [capture, ctx.menuId, openFocusedSubmenuIfPresent]);

    const closeOrParentMenu = useCallback(() => {
        if (ctx.level > 0) {
            ctx.close();
            ctx.triggerRef.current?.focus();
            return;
        }

        if (capture?.isCaptured && ctx.menuId) {
            const prevId = capture.getAdjacentTopLevelMenuId(ctx.menuId, -1);
            if (prevId) {
                capture.setActiveMenu(prevId);
                return;
            }
        }

        ctx.closeTree();
    }, [capture, ctx, ctx.menuId]);

    // Local shortcuts
    mgr.useActionHandler('Close', () => {
        if (ctx.level > 0) {
            ctx.close();
            ctx.triggerRef.current?.focus();
            return;
        }

        ctx.closeTree();
    });

    mgr.useActionHandler('NextItem', () => focusItemByDelta(1));
    mgr.useActionHandler('PrevItem', () => focusItemByDelta(-1));
    mgr.useActionHandler('ActivateItem', () => activateFocusedItem());
    mgr.useActionHandler('OpenOrNextMenu', () => openSubmenuOrNextMenu());
    mgr.useActionHandler('CloseOrParentMenu', () => closeOrParentMenu());

    return (
        <div
            role="menu"
            className={classes.join(' ')}
            style={contentStyle}
            ref={combinedRef}
            data-menu-root={ctx.rootId}
            data-menu-level={ctx.level}
            tabIndex={-1}
        >
            {children}
        </div>
    );
};

const MenuContent = React.forwardRef<HTMLDivElement, MenuContentProps>(({ children, className = '', minWidth, style, autoFocus = true }, forwardedRef) => {
    const ctx = useMenuContext('DesktopMenu.Content');
    const [position, setPosition] = useState(() => getMenuPosition(ctx.placement, ctx.triggerRef.current, null));
    const [contentNode, setContentNode] = useState<HTMLDivElement | null>(null);
    const combinedRef = composeRefs<HTMLDivElement>(forwardedRef, (node) => {
        ctx.contentRef.current = node;
        if (node) setContentNode(node);
    });

    useLayoutEffect(() => {
        if (!ctx.isOpen) return;
        const update = () => setPosition(getMenuPosition(ctx.placement, ctx.triggerRef.current, ctx.contentRef.current));
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [ctx.isOpen, ctx.placement, ctx.triggerRef, ctx.contentRef]);

    useEffect(() => {
        if (!ctx.isOpen) return;
        const handlePointerDown = (event: MouseEvent | PointerEvent) => {
            const target = event.target as HTMLElement;
            const withinTrigger = ctx.triggerRef.current?.contains(target);
            const withinMenuTree = target.closest(`[data-menu-root="${ctx.rootId}"]`);
            if (withinTrigger || withinMenuTree) return;
            ctx.closeTree();
        };
        // const handleKey = (event: KeyboardEvent) => {
        //     if (event.key === 'Escape') {
        //         event.preventDefault();
        //         ctx.closeTree();
        //         ctx.triggerRef.current?.focus();
        //     }
        // };
        document.addEventListener('pointerdown', handlePointerDown);
        //document.addEventListener('contextmenu', handlePointerDown);
        //window.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            //document.removeEventListener('contextmenu', handlePointerDown);
            //window.removeEventListener('keydown', handleKey);
        };
    }, [ctx]);

    useEffect(() => {
        if (!ctx.isOpen || !autoFocus) return;
        const focused = focusFirstItem(ctx.contentRef.current);
        if (!focused) {
            // Ensure focus stays within the menu so keyboard shortcuts (scoped to this menu content)
            // keep working even if all items are disabled.
            ctx.contentRef.current?.focus();
        }
    }, [autoFocus, ctx.isOpen]);

    if (!ctx.isOpen) return null;

    const portalHost = typeof document !== 'undefined' ? ensurePortalHost() : null;
    if (!portalHost) return null;

    const contentStyle: CSSProperties = {
        top: position.top,
        left: position.left,
        minWidth: minWidth ?? position.minWidth,
        ...style,
    };

    const classes = ['desktop-menu-popover', `desktop-menu-popover--level-${ctx.level}`];
    if (className) classes.push(className);

    return createPortal(
        <ShortcutManagerProvider<MenuActionId>
            name="DesktopMenu"
            actions={gMenuActionRegistry}
            attachTo={contentNode ?? document}
            eventPhase="capture"
        >
            <MenuContentBody
                ctx={ctx}
                classes={classes}
                contentStyle={contentStyle}
                combinedRef={combinedRef}
            >
                {children}
            </MenuContentBody>
        </ShortcutManagerProvider>,
        portalHost,
    );
});
MenuContent.displayName = 'DesktopMenuContent';

type MenuItemProps = {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: (event: React.MouseEvent | React.KeyboardEvent) => void;
    shortcut?: string;
    icon?: ReactNode;
    checked?: boolean;
    closeOnSelect?: boolean;
    inset?: boolean;
};

const MenuItem = React.forwardRef<HTMLDivElement, MenuItemProps>(({ children, disabled, onSelect, shortcut, icon, checked, closeOnSelect = true, inset }, forwardedRef) => {
    const ctx = useMenuContext('DesktopMenu.Item');
    const combinedRef = composeRefs<HTMLDivElement>(forwardedRef);

    const handleActivate = (event: React.MouseEvent | React.KeyboardEvent) => {
        if (disabled) {
            event.preventDefault();
            return;
        }
        onSelect?.(event);
        if (closeOnSelect) ctx.closeTree();
    };

    const handleClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
        event.stopPropagation();
        handleActivate(event);
    };

    const handlePointerEnter = () => {
        // When hovering over a regular menu item, close any open submenus at this level
        // This is done by finding all sub menus that might be open and closing them
        // Since we don't have direct access to sibling submenus, we rely on the parent menu
        // to manage this through the content's event handling
    };

    const classes = ['desktop-menu-item'];
    if (disabled) classes.push('desktop-menu-item--disabled');
    if (inset) classes.push('desktop-menu-item--inset');

    const leading = checked ? CharMap.Check : icon;

    return (
        <div
            role="menuitem"
            tabIndex={-1}
            aria-disabled={disabled || undefined}
            className={classes.join(' ')}
            onClick={handleClick}
            onPointerEnter={handlePointerEnter}
            ref={combinedRef}
            data-menu-item="true"
        >
            <span className="desktop-menu-item__leading">{leading}</span>
            <span className="desktop-menu-item__label">{children}</span>
            {shortcut && <span className="desktop-menu-item__shortcut">{shortcut}</span>}
        </div>
    );
});
MenuItem.displayName = 'DesktopMenuItem';

type MenuDividerProps = {
    inset?: boolean;
};

const MenuDivider: React.FC<MenuDividerProps> = ({ inset }) => (
    <div
        role="separator"
        className={`desktop-menu-divider${inset ? ' desktop-menu-divider--inset' : ''}`}
    />
);

type MenuLabelProps = {
    children: ReactNode;
};

const MenuLabel: React.FC<MenuLabelProps> = ({ children }) => (
    <div className="desktop-menu-label">{children}</div>
);

type MenuSubTriggerProps = {
    children: ReactNode;
    disabled?: boolean;
};

const MenuSubTrigger = React.forwardRef<HTMLDivElement, MenuSubTriggerProps>(({ children, disabled }, forwardedRef) => {
    const ctx = useMenuContext('DesktopMenu.SubTrigger');
    const combinedRef = composeRefs<HTMLDivElement>(forwardedRef, (node) => { ctx.triggerRef.current = node; });
    const timeoutRef = useRef<number | null>(null);

    const handleClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
        event.preventDefault();
        if (disabled) return;
        ctx.toggle();
    };

    const handlePointerEnter = () => {
        if (timeoutRef.current) {
            window.clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        if (!disabled) ctx.open();
    };

    const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
        // Only close if we're not moving into the submenu content
        const relatedTarget = event.relatedTarget as HTMLElement | null;
        const isMovingToContent = relatedTarget && ctx.contentRef.current?.contains(relatedTarget);

        if (!isMovingToContent && !disabled) {
            // Small delay to prevent flickering when moving between trigger and content
            timeoutRef.current = window.setTimeout(() => {
                // Check again if mouse is in content before closing
                if (!ctx.contentRef.current?.matches(':hover')) {
                    ctx.close();
                }
            }, 100);
        }
    };

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                window.clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    const classes = ['desktop-menu-item', 'desktop-menu-item--submenu'];
    if (disabled) classes.push('desktop-menu-item--disabled');

    return (
        <div
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={ctx.isOpen}
            tabIndex={-1}
            className={classes.join(' ')}
            onClick={handleClick}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
            ref={combinedRef}
            data-menu-item="true"
        >
            <span className="desktop-menu-item__leading"></span>
            <span className="desktop-menu-item__label">{children}</span>
            <span className="desktop-menu-item__shortcut">{CharMap.RightTriangle}</span>
        </div>
    );
});
MenuSubTrigger.displayName = 'DesktopMenuSubTrigger';

const MenuSubContent = MenuContent;

type MenuBarProps = {
    children: ReactNode;
};

// MenuBar provides the capture context for all top-level menus within it
const MenuBar: React.FC<MenuBarProps> = ({ children }) => {
    const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
    const focusHistory = useFocusHistory();
    const focusBookmarkRef = useRef<{ restore: () => void } | null>(null);
    const topLevelMenuIdsRef = useRef<string[]>([]);

    const registerTopLevelMenu = useCallback((menuId: string) => {
        if (!topLevelMenuIdsRef.current.includes(menuId)) {
            topLevelMenuIdsRef.current = [...topLevelMenuIdsRef.current, menuId];
        }
        return () => {
            topLevelMenuIdsRef.current = topLevelMenuIdsRef.current.filter(id => id !== menuId);
        };
    }, []);

    const getAdjacentTopLevelMenuId = useCallback((menuId: string, direction: -1 | 1) => {
        const ids = topLevelMenuIdsRef.current;
        if (ids.length < 2) return null;
        const idx = ids.indexOf(menuId);
        if (idx < 0) return null;
        const nextIdx = (idx + direction + ids.length) % ids.length;
        return ids[nextIdx] ?? null;
    }, []);

    useEffect(() => {
        if (activeMenuId !== null) {
            if (!focusBookmarkRef.current) {
                focusBookmarkRef.current = focusHistory.capturePrevious();
            }
            return;
        }

        console.log('MenuBar: restoring focus for menu close');
        focusBookmarkRef.current?.restore();
        focusBookmarkRef.current = null;
    }, [activeMenuId, focusHistory]);

    const captureValue = useMemo<MenuCaptureContextValue>(() => ({
        isCaptured: activeMenuId !== null,
        activeMenuId,
        setActiveMenu: setActiveMenuId,
        registerTopLevelMenu,
        getAdjacentTopLevelMenuId,
    }), [activeMenuId, getAdjacentTopLevelMenuId, registerTopLevelMenu]);

    return (
        <MenuCaptureContext.Provider value={captureValue}>
            {children}
        </MenuCaptureContext.Provider>
    );
};

export const DesktopMenu = {
    Root: MenuRoot,
    Trigger: MenuTrigger,
    Content: MenuContent,
    Item: MenuItem,
    Divider: MenuDivider,
    Label: MenuLabel,
    Sub: MenuSub,
    SubTrigger: MenuSubTrigger,
    SubContent: MenuSubContent,
    Bar: MenuBar,
};

type MenuFactory = typeof DesktopMenu;

export type DesktopMenuType = MenuFactory;
