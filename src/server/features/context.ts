import { Context } from '../../environment/context/context'
import { InitializeParams, ServerCapabilities } from '../../protocol'
import { ContextUpdateNotification, ContextUpdateParams } from '../../protocol/context'
import { Connection } from '../server'
import { Remote } from './common'

/**
 * The RemoteContext interface proxies the remote client's context (arbitrary key-value pairs that describe
 * application state).
 */
export interface RemoteContext extends Remote {
    /**
     * Apply the given updates to the client's context. The updates are merged with the client's existing context,
     * except that any properties whose update value is null are deleted.
     *
     * Implementation: sends a context/update notification to the client.
     */
    updateContext(updates: Context): void
}

export class RemoteContextImpl implements RemoteContext {
    private _connection?: Connection

    public attach(connection: Connection): void {
        this._connection = connection
    }

    public get connection(): Connection {
        if (!this._connection) {
            throw new Error('Remote is not attached to a connection yet.')
        }
        return this._connection
    }

    public initialize(_params: InitializeParams): void {
        /* noop */
    }

    public fillServerCapabilities(_capabilities: ServerCapabilities): void {
        /* noop */
    }

    public updateContext(updates: Context): void {
        this.connection.sendNotification(ContextUpdateNotification.type, { updates } as ContextUpdateParams)
    }
}
