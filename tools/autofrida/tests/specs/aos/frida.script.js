/* Bypass SSL Pinning */
setTimeout(function () {
	Java.perform(function () {

		var CertificateFactory = Java.use("java.security.cert.CertificateFactory");
		var FileInputStream = Java.use("java.io.FileInputStream");
		var BufferedInputStream = Java.use("java.io.BufferedInputStream");
		var X509Certificate = Java.use("java.security.cert.X509Certificate");
		var KeyStore = Java.use("java.security.KeyStore");
		var TrustManagerFactory = Java.use("javax.net.ssl.TrustManagerFactory");
		var SSLContext = Java.use("javax.net.ssl.SSLContext");

		// Load CAs from an InputStream
		console.log("[+] SSL Pinning: Load the Burp Suite Certificate Authority (CA) certificate")
		var cf = CertificateFactory.getInstance("X.509");

		try {
			var fileInputStream = FileInputStream.$new("/data/local/tmp/cert-der.crt");
		}
		catch (err) {
			console.log("[-] SSL Pinning: Unable to load the Burp Suite Certificate Authority certificate" + err);
		}

		var bufferedInputStream = BufferedInputStream.$new(fileInputStream);
		var ca = cf.generateCertificate(bufferedInputStream);
		bufferedInputStream.close();

		var certInfo = Java.cast(ca, X509Certificate);
		console.log("[+] SSL Pinning: CA certificate information: " + certInfo.getSubjectDN());

		console.log("[+] SSL Pinning: Creating a KeyStore for the CA");
		var keyStoreType = KeyStore.getDefaultType();
		var keyStore = KeyStore.getInstance(keyStoreType);
		keyStore.load(null, null);
		keyStore.setCertificateEntry("ca", ca);

		console.log("[+] SSL Pinning: Creating a TrustManager that trusts the CA in the KeyStore");
		var tmfAlgorithm = TrustManagerFactory.getDefaultAlgorithm();
		var tmf = TrustManagerFactory.getInstance(tmfAlgorithm);
		tmf.init(keyStore);
		console.log("[+] SSL Pinning: TrustManager is ready");

		console.log("[+] SSL Pinning: Hijacking SSLContext methods")
		console.log("[-] SSL Pinning: Waiting for the app to invoke SSLContext.init()")
		SSLContext.init.overload("[Ljavax.net.ssl.KeyManager;", "[Ljavax.net.ssl.TrustManager;", "java.security.SecureRandom").implementation = function (a, b, c) {
			console.log("[+] SSL Pinning: App invoked javax.net.ssl.SSLContext.init...");
			SSLContext.init.overload("[Ljavax.net.ssl.KeyManager;", "[Ljavax.net.ssl.TrustManager;", "java.security.SecureRandom").call(this, a, tmf.getTrustManagers(), c);
			console.log("[+] SSL Pinning: SSLContext initialized with our custom TrustManager!");
		}
	});
}, 1000);
