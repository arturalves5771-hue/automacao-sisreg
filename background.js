console.log("BACKGROUND SISREG INICIADO");

let abaNossaPagina = null;
let abaSISREG = null;

chrome.runtime.onMessage.addListener(async function (message, sender) {

    /*
    =================================================
    SOLICITAÇÃO DE LOGIN
    =================================================
    */
    if (message.type === "INICIAR_LOGIN_SISREG") {
        if (sender.tab) abaNossaPagina = sender.tab.id;

        await chrome.storage.session.set({
            loginSISREG: { username: message.username, password: message.password },
            operacaoAtual: "login",
            tentativaEnviada: false,
            abaNossaPagina: abaNossaPagina
        });

        const tab = await chrome.tabs.create({
            url: "https://sisregiii.saude.gov.br/cgi-bin/index",
            active: false
        });

        abaSISREG = tab.id;
        await chrome.storage.session.set({ abaSISREG: tab.id });
        return;
    }

    /*
    =================================================
    SOLICITAÇÃO DE EXPORTAÇÃO CSV
    =================================================
    */
    if (message.type === "EXPORTAR_CSV") {
        if (sender.tab) abaNossaPagina = sender.tab.id;

        if (!message.dataInicial || !message.dataFinal) {
            if (abaNossaPagina) {
                await chrome.tabs.sendMessage(abaNossaPagina, {
                    type: "EXPORTACAO_ERRO",
                    mensagem: "Informe a data inicial e a data final."
                });
            }
            return;
        }

        await chrome.storage.session.set({
            operacaoAtual: "exportar_csv",
            exportacaoCSV: { dataInicial: message.dataInicial, dataFinal: message.dataFinal },
            exportacaoIniciada: false,
            abaNossaPagina: abaNossaPagina
        });

        const tab = await chrome.tabs.create({
            url: "https://sisregiii.saude.gov.br/cgi-bin/index",
            active: false
        });

        abaSISREG = tab.id;
        await chrome.storage.session.set({ abaSISREG: tab.id });
        return;
    }

    /*
    =================================================
    ACOMPANHAMENTO DO ESTADO DO SISREG
    =================================================
    */
    if (message.type === "SISREG_ESTADO") {
        const tabId = sender.tab?.id;
        if (!tabId) return;

        const dados = await chrome.storage.session.get([
            "loginSISREG", "abaSISREG", "abaNossaPagina", "operacaoAtual", "exportacaoCSV", "exportacaoIniciada", "tentativaEnviada"
        ]);

        if (dados.abaSISREG !== tabId) return;

        /*
        ---------------------------------------------
        OPERAÇÃO: LOGIN
        ---------------------------------------------
        */
        if (dados.operacaoAtual === "login") {

            // CASO 1: ERRO DE SENHA / LOGIN INCORRETO
            if (message.erroLogin) {
                console.log("LOGIN INCORRETO DETECTADO.");

                if (dados.abaNossaPagina) {
                    try {
                        await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                            type: "LOGIN_SISREG_ERRO",
                            mensagem: "Login ou senha incorreto(s). Verifique suas credenciais."
                        });
                    } catch (e) {}
                }

                await chrome.storage.session.set({ operacaoAtual: null });
                await chrome.storage.session.remove(["loginSISREG", "abaSISREG", "tentativaEnviada"]);

                setTimeout(async () => {
                    try { await chrome.tabs.remove(tabId); } catch (e) {}
                }, 500);

                return;
            }

            // CASO 2: TELA DE LOGIN (PREENCHER UMA ÚNICA VEZ)
            if (message.telaLogin === true) {
                if (dados.tentativaEnviada) return; // Evita loop infinito de envio

                const login = dados.loginSISREG;
                if (!login) return;

                await chrome.storage.session.set({ tentativaEnviada: true });

                try {
                    await chrome.tabs.sendMessage(tabId, {
                        type: "PREENCHER_LOGIN",
                        username: login.username,
                        password: login.password
                    });
                } catch (erro) {}

                return;
            }

            // CASO 3: LOGADO COM SUCESSO
            if (message.telaLogin === false) {
                await chrome.storage.session.set({ operacaoAtual: null });
                await chrome.storage.session.remove(["loginSISREG", "abaSISREG", "tentativaEnviada"]);

                if (dados.abaNossaPagina) {
                    try {
                        await chrome.tabs.sendMessage(dados.abaNossaPagina, { type: "LOGIN_SISREG_SUCESSO" });
                    } catch (e) {}
                }

                setTimeout(async () => {
                    try { await chrome.tabs.remove(tabId); } catch (e) {}
                }, 700);

                return;
            }
        }

        /*
        ---------------------------------------------
        OPERAÇÃO: EXPORTAÇÃO CSV
        ---------------------------------------------
        */
        if (dados.operacaoAtual === "exportar_csv") {
            if (message.telaLogin === true) {
                if (dados.abaNossaPagina) {
                    try {
                        await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                            type: "EXPORTACAO_ERRO",
                            mensagem: "Sessão expirada. Faça login novamente."
                        });
                    } catch (e) {}
                }

                await chrome.storage.session.set({ operacaoAtual: null });
                setTimeout(async () => { try { await chrome.tabs.remove(tabId); } catch (e) {} }, 500);
                return;
            }

            if (message.telaLogin === false) {
                const exportacao = dados.exportacaoCSV;
                if (!exportacao) return;

                // O SISREG pode informar "telaLogin=false" mais de uma vez
                // durante o carregamento. A exportação deve ser executada apenas uma vez.
                if (dados.exportacaoIniciada) return;

                await chrome.storage.session.set({
                    exportacaoIniciada: true
                });

                try {
                    await chrome.tabs.sendMessage(tabId, {
                        type: "EXECUTAR_EXPORTACAO_CSV",
                        dataInicial: exportacao.dataInicial,
                        dataFinal: exportacao.dataFinal
                    });
                } catch (e) {}
                return;
            }
        }
    }

    /*
    =================================================
    DOWNLOAD E SUBSTITUIÇÃO DO CSV
    =================================================
    */
    if (message.type === "EFETUAR_DOWNLOAD_SUBSTITUIR") {
        const dados = await chrome.storage.session.get(["abaNossaPagina", "abaSISREG"]);

        chrome.downloads.download({
            url: message.dataUrl,
            filename: message.nomeArquivo,
            conflictAction: "overwrite"
        }, async (downloadId) => {
            if (chrome.runtime.lastError) {
                if (dados.abaNossaPagina) {
                    chrome.tabs.sendMessage(dados.abaNossaPagina, {
                        type: "EXPORTACAO_ERRO",
                        mensagem: "Erro ao salvar arquivo: " + chrome.runtime.lastError.message
                    });
                }
            } else {
                if (dados.abaNossaPagina) {
                    chrome.tabs.sendMessage(dados.abaNossaPagina, {
                        type: "EXPORTACAO_SUCESSO",
                        mensagem: "CSV exportado e atualizado com sucesso (" + message.nomeArquivo + ")"
                    });
                }
            }

            await chrome.storage.session.set({ operacaoAtual: null });
            await chrome.storage.session.remove(["exportacaoCSV", "exportacaoIniciada"]);

            if (dados.abaSISREG) {
                setTimeout(async () => {
                    try { await chrome.tabs.remove(dados.abaSISREG); } catch (e) {}
                }, 1000);
            }
        });

        return;
    }

    /*
    =================================================
    TRATAMENTO DE ERRO DE EXPORTAÇÃO
    =================================================
    */
    if (message.type === "EXPORTACAO_ERRO") {
        const dados = await chrome.storage.session.get(["abaNossaPagina", "abaSISREG"]);

        if (dados.abaNossaPagina) {
            try {
                await chrome.tabs.sendMessage(dados.abaNossaPagina, {
                    type: "EXPORTACAO_ERRO",
                    mensagem: message.mensagem
                });
            } catch (e) {}
        }

        await chrome.storage.session.set({ operacaoAtual: null });
        await chrome.storage.session.remove("exportacaoCSV");

        if (dados.abaSISREG) {
            setTimeout(async () => {
                try { await chrome.tabs.remove(dados.abaSISREG); } catch (e) {}
            }, 500);
        }
        return;
    }
});
