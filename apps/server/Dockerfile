FROM golang:1.27 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -o /savetab-server ./cmd/savetab-server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /savetab-server /savetab-server
EXPOSE 8080
ENTRYPOINT ["/savetab-server"]
