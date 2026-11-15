package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/logline"
)

// tracer counts each query, and the time it took, on the log line of the unit of work its
// context belongs to. A query outside one, such as a migration, counts nowhere.
type tracer struct{}

var (
	_ pgx.QueryTracer    = tracer{}
	_ pgx.BatchTracer    = tracer{}
	_ pgx.CopyFromTracer = tracer{}
)

type startedKey struct{}

func started(ctx context.Context) context.Context {
	return context.WithValue(ctx, startedKey{}, time.Now())
}

func ended(ctx context.Context, queries int64) {
	if start, ok := ctx.Value(startedKey{}).(time.Time); ok {
		logline.AddQueries(ctx, queries, time.Since(start))
	}
}

func (tracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	return started(ctx)
}

func (tracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryEndData) { ended(ctx, 1) }

// SendBatch calls no TraceQueryStart, so a batch counts each of its queries here.
func (tracer) TraceBatchStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceBatchStartData) context.Context {
	return started(ctx)
}

func (tracer) TraceBatchQuery(ctx context.Context, _ *pgx.Conn, _ pgx.TraceBatchQueryData) {
	logline.AddQueries(ctx, 1, 0)
}

func (tracer) TraceBatchEnd(ctx context.Context, _ *pgx.Conn, _ pgx.TraceBatchEndData) { ended(ctx, 0) }

func (tracer) TraceCopyFromStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceCopyFromStartData) context.Context {
	return started(ctx)
}

func (tracer) TraceCopyFromEnd(ctx context.Context, _ *pgx.Conn, _ pgx.TraceCopyFromEndData) {
	ended(ctx, 1)
}
