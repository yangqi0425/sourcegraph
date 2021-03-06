import classNames from 'classnames'
import { LoadingSpinner } from '@sourcegraph/react-loading-spinner'
import * as H from 'history'
import FolderIcon from 'mdi-react/FolderIcon'
import HistoryIcon from 'mdi-react/HistoryIcon'
import SourceBranchIcon from 'mdi-react/SourceBranchIcon'
import SourceCommitIcon from 'mdi-react/SourceCommitIcon'
import SourceRepositoryIcon from 'mdi-react/SourceRepositoryIcon'
import TagIcon from 'mdi-react/TagIcon'
import UserIcon from 'mdi-react/UserIcon'
import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { Link, Redirect } from 'react-router-dom'
import { Observable, EMPTY } from 'rxjs'
import { catchError, map } from 'rxjs/operators'
import { ActionItem } from '../../../../shared/src/actions/ActionItem'
import { ActionsContainer } from '../../../../shared/src/actions/ActionsContainer'
import { ContributableMenu, ContributableViewContainer } from '../../../../shared/src/api/protocol'
import { ActivationProps } from '../../../../shared/src/components/activation/Activation'
import { displayRepoName } from '../../../../shared/src/components/RepoFileLink'
import { ExtensionsControllerProps } from '../../../../shared/src/extensions/controller'
import { gql, dataOrThrowErrors } from '../../../../shared/src/graphql/graphql'
import * as GQL from '../../../../shared/src/graphql/schema'
import { PlatformContextProps } from '../../../../shared/src/platform/context'
import { SettingsCascadeProps } from '../../../../shared/src/settings/settings'
import { asError, ErrorLike, isErrorLike } from '../../../../shared/src/util/errors'
import { memoizeObservable } from '../../../../shared/src/util/memoizeObservable'
import { queryGraphQL } from '../../backend/graphql'
import { FilteredConnection } from '../../components/FilteredConnection'
import { PageTitle } from '../../components/PageTitle'
import { PatternTypeProps, CaseSensitivityProps, CopyQueryButtonProps } from '../../search'
import { eventLogger, EventLoggerProps } from '../../tracking/eventLogger'
import { basename } from '../../util/path'
import { fetchTreeEntries } from '../backend'
import { GitCommitNode, GitCommitNodeProps } from '../commits/GitCommitNode'
import { gitCommitFragment } from '../commits/RepositoryCommitsPage'
import { ThemeProps } from '../../../../shared/src/theme'
import { ErrorAlert } from '../../components/alerts'
import { subYears, formatISO } from 'date-fns'
import { pluralize } from '../../../../shared/src/util/strings'
import { useObservable } from '../../../../shared/src/util/useObservable'
import { toPrettyBlobURL, toURIWithPath } from '../../../../shared/src/util/url'
import { getViewsForContainer } from '../../../../shared/src/api/client/services/viewService'
import { Settings } from '../../schema/settings.schema'
import { ViewGrid } from './ViewGrid'
import { VersionContextProps } from '../../../../shared/src/search/util'

const TreeEntry: React.FunctionComponent<{
    isDir: boolean
    name: string
    parentPath: string
    url: string
}> = ({ isDir, name, parentPath, url }) => {
    const filePath = parentPath ? parentPath + '/' + name : name
    return (
        <Link
            to={url}
            className={classNames(
                'tree-entry',
                isDir && 'font-weight-bold',
                `e2e-tree-entry-${isDir ? 'directory' : 'file'}`
            )}
            title={filePath}
        >
            {name}
            {isDir && '/'}
        </Link>
    )
}

/**
 * Use a multi-column layout for tree entries when there are at least this many. See TreePage.scss
 * for more information.
 */
const MIN_ENTRIES_FOR_COLUMN_LAYOUT = 6

const TreeEntriesSection: React.FunctionComponent<{
    title: string
    parentPath: string
    entries: Pick<GQL.ITreeEntry, 'name' | 'isDirectory' | 'url'>[]
}> = ({ title, parentPath, entries }) =>
    entries.length > 0 ? (
        <section className="tree-page__section e2e-tree-entries">
            <h3 className="tree-page__section-header">{title}</h3>
            <div className={entries.length > MIN_ENTRIES_FOR_COLUMN_LAYOUT ? 'tree-page__entries--columns' : undefined}>
                {entries.map((e, i) => (
                    <TreeEntry
                        key={e.name + String(i)}
                        isDir={e.isDirectory}
                        name={e.name}
                        parentPath={parentPath}
                        url={e.url}
                    />
                ))}
            </div>
        </section>
    ) : null

const fetchTreeCommits = memoizeObservable(
    (args: {
        repo: GQL.ID
        revspec: string
        first?: number
        filePath?: string
        after?: string
    }): Observable<GQL.IGitCommitConnection> =>
        queryGraphQL(
            gql`
                query TreeCommits($repo: ID!, $revspec: String!, $first: Int, $filePath: String, $after: String) {
                    node(id: $repo) {
                        __typename
                        ... on Repository {
                            commit(rev: $revspec) {
                                ancestors(first: $first, path: $filePath, after: $after) {
                                    nodes {
                                        ...GitCommitFields
                                    }
                                    pageInfo {
                                        hasNextPage
                                    }
                                }
                            }
                        }
                    }
                }
                ${gitCommitFragment}
            `,
            args
        ).pipe(
            map(dataOrThrowErrors),
            map(data => {
                if (!data.node) {
                    throw new Error('Repository not found')
                }
                if (data.node.__typename !== 'Repository') {
                    throw new Error('Node is not a Repository')
                }
                if (!data.node.commit) {
                    throw new Error('Commit not found')
                }
                return data.node.commit.ancestors
            })
        ),
    args => `${args.repo}:${args.revspec}:${String(args.first)}:${String(args.filePath)}:${String(args.after)}`
)

interface Props
    extends SettingsCascadeProps<Settings>,
        ExtensionsControllerProps,
        PlatformContextProps,
        ThemeProps,
        EventLoggerProps,
        ActivationProps,
        PatternTypeProps,
        CaseSensitivityProps,
        CopyQueryButtonProps,
        VersionContextProps {
    repoName: string
    repoID: GQL.ID
    repoDescription: string
    /** The tree's path in TreePage. We call it filePath for consistency elsewhere. */
    filePath: string
    commitID: string
    rev: string
    location: H.Location
    history: H.History
}

export const TreePage: React.FunctionComponent<Props> = ({
    repoName,
    repoID,
    repoDescription,
    commitID,
    rev,
    filePath,
    patternType,
    caseSensitive,
    settingsCascade,
    ...props
}) => {
    useEffect(() => {
        if (filePath === '') {
            eventLogger.logViewEvent('Repository')
        } else {
            eventLogger.logViewEvent('Tree')
        }
    }, [filePath])

    const [showOlderCommits, setShowOlderCommits] = useState(false)

    const onShowOlderCommitsClicked = useCallback(
        (e: React.MouseEvent): void => {
            e.preventDefault()
            setShowOlderCommits(true)
        },
        [setShowOlderCommits]
    )

    const treeOrError = useObservable(
        useMemo(
            () =>
                fetchTreeEntries({
                    repoName,
                    commitID,
                    rev,
                    filePath,
                    first: 2500,
                }).pipe(catchError((err): [ErrorLike] => [asError(err)])),
            [repoName, commitID, rev, filePath]
        )
    )

    const { services } = props.extensionsController

    const codeInsightsEnabled =
        !isErrorLike(settingsCascade.final) && !!settingsCascade.final?.experimentalFeatures?.codeInsights

    // Add DirectoryViewer
    const uri = toURIWithPath({ repoName, commitID, filePath })
    useEffect(() => {
        if (!codeInsightsEnabled) {
            return
        }
        const viewerId = services.viewer.addViewer({
            type: 'DirectoryViewer',
            isActive: true,
            resource: uri,
        })
        return () => services.viewer.removeViewer(viewerId)
    }, [services.viewer, services.model, uri, codeInsightsEnabled])

    // Observe directory views
    const workspaceUri = services.workspace.roots.value[0]?.uri
    const views = useObservable(
        useMemo(
            () =>
                codeInsightsEnabled && workspaceUri
                    ? getViewsForContainer(
                          ContributableViewContainer.Directory,
                          {
                              viewer: {
                                  type: 'DirectoryViewer',
                                  directory: {
                                      uri,
                                  },
                              },
                              workspace: {
                                  uri: workspaceUri,
                              },
                          },
                          services.view
                      )
                    : EMPTY,
            [codeInsightsEnabled, workspaceUri, uri, services.view]
        )
    )

    const getPageTitle = (): string => {
        const repoStr = displayRepoName(repoName)
        if (filePath) {
            return `${basename(filePath)} - ${repoStr}`
        }
        return `${repoStr}`
    }

    const queryCommits = useCallback(
        (args: { first?: number }): Observable<GQL.IGitCommitConnection> => {
            const after: string | undefined = showOlderCommits ? undefined : formatISO(subYears(Date.now(), 1))
            return fetchTreeCommits({
                ...args,
                repo: repoID,
                revspec: rev || '',
                filePath,
                after,
            })
        },
        [filePath, repoID, rev, showOlderCommits]
    )

    const emptyElement = showOlderCommits ? (
        <>No commits in this tree.</>
    ) : (
        <div className="e2e-tree-page-no-recent-commits">
            No commits in this tree in the past year.
            <br />
            <button
                type="button"
                className="btn btn-secondary btn-sm e2e-tree-page-show-all-commits"
                onClick={onShowOlderCommitsClicked}
            >
                Show all commits
            </button>
        </div>
    )

    const TotalCountSummary: React.FunctionComponent<{ totalCount: number }> = ({ totalCount }) => (
        <div className="mt-2">
            {showOlderCommits ? (
                <>{totalCount} total commits in this tree.</>
            ) : (
                <>
                    {totalCount} {pluralize('commit', totalCount)} in this tree in the past year.
                    <br />
                    <button type="button" className="btn btn-secondary btn-sm mt-1" onClick={onShowOlderCommitsClicked}>
                        Show all commits
                    </button>
                </>
            )}
        </div>
    )
    return (
        <div className="tree-page">
            <PageTitle title={getPageTitle()} />
            {treeOrError === undefined ? (
                <div>
                    <LoadingSpinner className="icon-inline tree-page__entries-loader" /> Loading files and directories
                </div>
            ) : isErrorLike(treeOrError) ? (
                // If the tree is actually a blob, be helpful and redirect to the blob page.
                // We don't have error names on GraphQL errors.
                /not a directory/i.test(treeOrError.message) ? (
                    <Redirect to={toPrettyBlobURL({ repoName, rev, commitID, filePath })} />
                ) : (
                    <ErrorAlert error={treeOrError} history={props.history} />
                )
            ) : (
                <>
                    <header className="mb-3">
                        {treeOrError.isRoot ? (
                            <>
                                <h2 className="tree-page__title">
                                    <SourceRepositoryIcon className="icon-inline" /> {displayRepoName(repoName)}
                                </h2>
                                {repoDescription && <p>{repoDescription}</p>}
                                <div className="btn-group mb-3">
                                    <Link className="btn btn-secondary" to={`${treeOrError.url}/-/commits`}>
                                        <SourceCommitIcon className="icon-inline" /> Commits
                                    </Link>
                                    <Link className="btn btn-secondary" to={`/${repoName}/-/branches`}>
                                        <SourceBranchIcon className="icon-inline" /> Branches
                                    </Link>
                                    <Link className="btn btn-secondary" to={`/${repoName}/-/tags`}>
                                        <TagIcon className="icon-inline" /> Tags
                                    </Link>
                                    <Link
                                        className="btn btn-secondary"
                                        to={
                                            rev
                                                ? `/${repoName}/-/compare/...${encodeURIComponent(rev)}`
                                                : `/${repoName}/-/compare`
                                        }
                                    >
                                        <HistoryIcon className="icon-inline" /> Compare
                                    </Link>
                                    <Link className="btn btn-secondary" to={`/${repoName}/-/stats/contributors`}>
                                        <UserIcon className="icon-inline" /> Contributors
                                    </Link>
                                </div>
                            </>
                        ) : (
                            <h2 className="tree-page__title">
                                <FolderIcon className="icon-inline" /> {filePath}
                            </h2>
                        )}
                    </header>
                    {views && (
                        <ViewGrid
                            {...props}
                            className="tree-page__section"
                            views={views}
                            patternType={patternType}
                            settingsCascade={settingsCascade}
                            caseSensitive={caseSensitive}
                        />
                    )}
                    <TreeEntriesSection
                        title="Files and directories"
                        parentPath={filePath}
                        entries={treeOrError.entries}
                    />
                    {/* eslint-disable react/jsx-no-bind */}
                    <ActionsContainer
                        {...props}
                        menu={ContributableMenu.DirectoryPage}
                        render={items => (
                            <section className="tree-page__section">
                                <h3 className="tree-page__section-header">Actions</h3>
                                {items.map(item => (
                                    <ActionItem
                                        {...props}
                                        key={item.action.id}
                                        {...item}
                                        className="btn btn-secondary mr-1 mb-1"
                                    />
                                ))}
                            </section>
                        )}
                        empty={null}
                    />
                    {/* eslint-enable react/jsx-no-bind */}
                    <div className="tree-page__section">
                        <h3 className="tree-page__section-header">Changes</h3>
                        <FilteredConnection<GQL.IGitCommit, Pick<GitCommitNodeProps, 'className' | 'compact'>>
                            location={props.location}
                            className="mt-2 tree-page__section--commits"
                            listClassName="list-group list-group-flush"
                            noun="commit in this tree"
                            pluralNoun="commits in this tree"
                            queryConnection={queryCommits}
                            nodeComponent={GitCommitNode}
                            nodeComponentProps={{
                                className: 'list-group-item',
                                compact: true,
                            }}
                            updateOnChange={`${repoName}:${rev}:${filePath}:${String(showOlderCommits)}`}
                            defaultFirst={7}
                            useURLQuery={false}
                            hideSearch={true}
                            emptyElement={emptyElement}
                            // eslint-disable-next-line react/jsx-no-bind
                            totalCountSummaryComponent={TotalCountSummary}
                        />
                    </div>
                </>
            )}
        </div>
    )
}
