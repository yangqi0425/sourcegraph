package db

import "github.com/pkg/errors"

// ErrNotTransactable occurs when Transact is called on a Database whose underlying
// db handle does not support beginning a transaction.
var ErrNotTransactable = errors.New("db: not transactable")

// ErrNoTransaction occurs when Savepoint or RollbackToSavepoint is called outside of a transaction.
var ErrNoTransaction = errors.New("db: not in a transaction")

// ErrDequeueTransaction occurs when Dequeue is called from inside a transaction.
var ErrDequeueTransaction = errors.New("unexpected transaction")

// ErrDequeueRace occurs when an upload selected for dequeue has been locked by another worker.
var ErrDequeueRace = errors.New("unexpected transaction")

// ErrNoSavepoint occurs when there is no savepont to rollback to.
var ErrNoSavepoint = errors.New("no savepoint defined")

// ErrUnknownRepository occurs when a repository does not exist.
var ErrUnknownRepository = errors.New("unknown repository")
