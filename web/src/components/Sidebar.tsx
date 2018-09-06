import React from 'react'
import { NavLink } from 'react-router-dom'

export const SIDEBAR_CARD_CLASS = 'card mb-3'

export const SIDEBAR_LIST_GROUP_ITEM_ACTION_CLASS = 'list-group-item list-group-item-action py-2'

export const SIDEBAR_BUTTON_CLASS = 'btn btn-secondary d-block w-100 my-2'

/**
 * Item of `SideBarGroupItems`.
 */
export const SidebarNavItem: React.SFC<{ to: string; exact?: boolean; className?: string }> = ({
    children,
    to,
    exact,
    className = '',
}) => (
    <NavLink to={to} exact={exact} className={`${SIDEBAR_LIST_GROUP_ITEM_ACTION_CLASS} ${className}`}>
        {children}
    </NavLink>
)

/**
 * Header of a `SideBarGroup`
 */
export const SidebarGroupHeader: React.SFC<{
    icon?: React.ComponentType<{ className?: string }>
    label: string
    children?: undefined
}> = ({ icon: Icon, label }) => (
    <div className="card-header">
        {Icon && <Icon className="icon-inline" />} {label}
    </div>
)

/**
 * A box of items in the side bar. Use `SideBarGroupHeader` and `SideBarGroupItems` as children.
 */
export const SidebarGroup: React.SFC<{}> = ({ children }) => <div className={SIDEBAR_CARD_CLASS}>{children}</div>

/**
 * Container for all `SideBarNavItem` in a `SideBarGroup`.
 */
export const SidebarGroupItems: React.SFC<{}> = ({ children }) => (
    <div className="list-group list-group-flush">{children}</div>
)

/**
 * Used to customize sidebar items
 *
 * @template C Context information that is made available to determine whether the item should be shown (different for each sidebar)
 */
export interface SidebarItem<C extends object = {}> {
    /** The text of the item */
    label: string

    /** The link destination (appended to the current match) */
    to: string

    /** Whether highlighting the item should only be done if `to` matches exactly */
    exact?: boolean

    /** Optional condition under which this item should be shown */
    condition?: (context: C) => boolean
}
