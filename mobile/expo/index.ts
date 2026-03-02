import { ApolloProvider } from "@apollo/client/react"
import { registerRootComponent } from "expo"
import { createElement, type ComponentProps } from "react"

import App from "./App"
import { apolloClient } from "./src/lib/apolloClient"

const Root = () =>
  createElement(ApolloProvider, {
    client: apolloClient,
    children: createElement(App),
  } as ComponentProps<typeof ApolloProvider>)
// Expo expects React.FC; React 19 ComponentType is incompatible—minimal cast for compatibility.
registerRootComponent(Root as Parameters<typeof registerRootComponent>[0])
