console.log("AUTOMAÇÃO SISREG: content.js carregado");

/*
=========================================================
PARTE 1: COMUNICAÇÃO COM NOSSA PÁGINA HTML
=========================================================
*/
window.addEventListener("message", function (event) {
    if (event.source !== window || !event.data) return;

    if (event.data.type === "SISREG_LOGIN") {
        if (!event.data.username || !event.data.password) return;
        chrome.runtime.sendMessage({
            type: "INICIAR_LOGIN_SISREG",
            username: event.data.username,
            password: event.data.password
        });
        return;
    }

    if (event.data.type === "EXPORTAR_CSV") {
        chrome.runtime.sendMessage({
            type: "EXPORTAR_CSV",
            dataInicial: event.data.dataInicial,
            dataFinal: event.data.dataFinal
        });
        return;
    }

    if (event.data.type === "ARQUIVO_SALVO_DIRETO") {
        chrome.runtime.sendMessage({
            type: "ARQUIVO_SALVO_DIRETO",
            nomeArquivo: event.data.nomeArquivo
        });
        return;
    }

    if (event.data.type === "ERRO_SALVAR_ARQUIVO") {
        chrome.runtime.sendMessage({
            type: "ERRO_SALVAR_ARQUIVO",
            mensagem: event.data.mensagem
        });
        return;
    }
});

/*
=========================================================
PARTE 2: RECEBER RESPOSTA DO BACKGROUND
=========================================================
*/
chrome.runtime.onMessage.addListener(function (message) {
    if (message.type === "LOGIN_SISREG_SUCESSO") {
        window.postMessage({ type: "LOGIN_SISREG_SUCESSO" }, "*");
        return;
    }

    if (message.type === "LOGIN_SISREG_ERRO") {
        window.postMessage({ type: "LOGIN_SISREG_ERRO", mensagem: message.mensagem }, "*");
        return;
    }

    if (message.type === "ARQUIVO_CSV_PRONTO") {
        window.postMessage({
            type: "ARQUIVO_CSV_PRONTO",
            dataUrl: message.dataUrl,
            nomeArquivo: message.nomeArquivo
        }, "*");
        return;
    }

    if (message.type === "EXPORTACAO_SUCESSO") {
        window.postMessage({ type: "EXPORTACAO_SUCESSO", mensagem: message.mensagem }, "*");
        return;
    }

    if (message.type === "EXPORTACAO_ERRO") {
        window.postMessage({ type: "EXPORTACAO_ERRO", mensagem: message.mensagem }, "*");
        return;
    }
});

/*
=========================================================
PARTE 3: CÓDIGO EXCLUSIVO DO SISREG (sisregiii.saude.gov.br)
=========================================================
*/
if (location.hostname === "sisregiii.saude.gov.br") {
    console.log("EXTENSÃO EXECUTANDO DENTRO DO SISREG.");

    /*
    -----------------------------------------------------
    Verifica estado da tela e presença de erros de login
    -----------------------------------------------------
    */
    function verificarEstadoSISREG() {
        const campoUsuario = document.querySelector("#usuario");
        const campoSenha = document.querySelector("#senha");
        const telaLogin = !!campoUsuario && !!campoSenha;

        const textoPagina = document.body ? document.body.innerText : "";
        const erroLogin = telaLogin && (
            textoPagina.includes("Login ou senha incorreto") ||
            textoPagina.includes("incorreto(s)") ||
            textoPagina.includes("Senha inválida") ||
            textoPagina.includes("Usuário não encontrado")
        );

        return { telaLogin, erroLogin };
    }

    function informarEstadoSISREG() {
        const estado = verificarEstadoSISREG();
        chrome.runtime.sendMessage({
            type: "SISREG_ESTADO",
            telaLogin: estado.telaLogin,
            erroLogin: estado.erroLogin
        });
    }

    setTimeout(informarEstadoSISREG, 800);

    let ultimoEstado = null;
    let ultimoErro = null;

    setInterval(function () {
        const estado = verificarEstadoSISREG();

        if (estado.telaLogin !== ultimoEstado || estado.erroLogin !== ultimoErro) {
            ultimoEstado = estado.telaLogin;
            ultimoErro = estado.erroLogin;

            chrome.runtime.sendMessage({
                type: "SISREG_ESTADO",
                telaLogin: estado.telaLogin,
                erroLogin: estado.erroLogin
            });
        }
    }, 500);

    /*
    -----------------------------------------------------
    RECEBER E PREENCHER CREDENCIAIS DE LOGIN
    -----------------------------------------------------
    */
    chrome.runtime.onMessage.addListener(function (message) {
        if (message.type !== "PREENCHER_LOGIN") return;

        const campoUsuario = document.querySelector("#usuario");
        const campoSenha = document.querySelector("#senha");

        if (!campoUsuario || !campoSenha) return;

        campoUsuario.value = message.username;
        campoUsuario.dispatchEvent(new Event("input", { bubbles: true }));
        campoUsuario.dispatchEvent(new Event("change", { bubbles: true }));

        campoSenha.value = message.password;
        campoSenha.dispatchEvent(new Event("input", { bubbles: true }));
        campoSenha.dispatchEvent(new Event("change", { bubbles: true }));

        setTimeout(function () {
            const botaoEntrar = document.querySelector('[name="entrar"]');
            if (botaoEntrar) botaoEntrar.click();
        }, 500);
    });

    /*
    -----------------------------------------------------
    EXPORTAÇÃO DO ARQUIVO CSV
    -----------------------------------------------------
    */
    chrome.runtime.onMessage.addListener(async function (message) {
        if (message.type !== "EXECUTAR_EXPORTACAO_CSV") return;

        try {
            const dados = new URLSearchParams();
            dados.append("data1", message.dataInicial);
            dados.append("data2", message.dataFinal);
            dados.append("cpf", "0");
            dados.append("procedimento", "0");
            dados.append("tp_arquivo", "1");
            dados.append("etapa", "exportar");
            dados.append("unidade", "2399318");

            const resposta = await fetch("https://sisregiii.saude.gov.br/cgi-bin/expo_solicitacoes", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: dados.toString()
            });

            if (!resposta.ok) {
                throw new Error("O SISREG retornou erro HTTP " + resposta.status);
            }

            const blob = await resposta.blob();
            if (blob.size === 0) {
                throw new Error("O SISREG retornou um arquivo vazio.");
            }

            // Gerar Nome no padrão: agenda_sisreg_YYYYMMDD.csv
            const agora = new Date();
            const ano = agora.getFullYear();
            const mes = String(agora.getMonth() + 1).padStart(2, "0");
            const dia = String(agora.getDate()).padStart(2, "0");
            const nomeArquivo = `agenda_sisreg_${ano}${mes}${dia}.csv`;

            // Converte o arquivo para enviar ao background e fazer download com substituição
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = function () {
                chrome.runtime.sendMessage({
                    type: "EFETUAR_DOWNLOAD_SUBSTITUIR",
                    dataUrl: reader.result,
                    nomeArquivo: nomeArquivo
                });
            };

        } catch (erro) {
            chrome.runtime.sendMessage({
                type: "EXPORTACAO_ERRO",
                mensagem: "Não foi possível exportar o CSV: " + erro.message
            });
        }
    });
}
