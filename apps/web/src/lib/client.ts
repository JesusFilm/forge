import { InMemoryCache } from "@apollo/client"
import { HttpLink } from "@apollo/client"
import { ApolloClient } from "@apollo/client"

const client = new ApolloClient({
  link: new HttpLink({ uri: process.env.NEXT_PUBLIC_GRAPHQL_URL }),
  cache: new InMemoryCache(),
})

export default client
