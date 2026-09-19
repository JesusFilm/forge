# curl + jq only. This service makes one authenticated POST and inspects the
# response; it builds nothing from the workspace.
FROM alpine:3.22
RUN apk add --no-cache curl jq
WORKDIR /app
COPY apps/subtitle-eval-recovery/run.sh ./run.sh
RUN chmod +x ./run.sh
CMD ["sh", "./run.sh"]
