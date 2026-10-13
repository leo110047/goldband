FROM node:22-bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive
ARG CLAUDE_CODE_VERSION=2.1.201
ARG CODEX_CLI_VERSION=0.142.5
ARG BUN_VERSION=1.3.11

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        git \
        jq \
        openssh-client \
        python3 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g \
        "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
        "@openai/codex@${CODEX_CLI_VERSION}" \
        "bun@${BUN_VERSION}"

RUN useradd -m -s /bin/bash goldband

COPY --chown=goldband:goldband . /opt/goldband

ENV HOME=/home/goldband \
    GOLDBAND_CONTAINER=1 \
    GOLDBAND_SKIP_BUILD=1 \
    GOLDBAND_SKIP_COREUTILS=1 \
    GOLDBAND_SKIP_GENERATE=1 \
    GOLDBAND_SKIP_PLAYWRIGHT=1

USER goldband
WORKDIR /opt/goldband
RUN rm -rf \
        goldband-loop/design/dist \
        goldband-loop/make-pdf/dist \
    && GOLDBAND_SKIP_BUILD=0 ./install.sh all-with-workflow
RUN git init \
    && git add -A \
    && node scripts/check-goldband-loop-inventory.mjs \
    && rm -rf .git

USER root
RUN chmod -R a-w /opt/goldband

USER goldband
WORKDIR /workspace/project

CMD ["/bin/bash"]
