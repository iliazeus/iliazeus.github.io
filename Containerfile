FROM ubuntu:24.04

ADD https://github.com/getzola/zola/releases/download/v0.19.2/zola-v0.19.2-x86_64-unknown-linux-gnu.tar.gz \
    /tmp
RUN mkdir -p /usr/local/bin && cd /usr/local/bin && tar xzf /tmp/zola-v0.19.2-x86_64-unknown-linux-gnu.tar.gz

USER ubuntu
WORKDIR /var/www
ENTRYPOINT ["zola"]
