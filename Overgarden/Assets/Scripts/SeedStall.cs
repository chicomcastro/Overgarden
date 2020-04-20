using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class SeedStall : MonoBehaviour
{
    private bool Interaction = false;
    public GameObject seedUI;
    public Text pressOpen;
    public GameObject SpawnPoint;
    public GameObject Player;
    public GameObject spawnedSeed;
    
    
    void Update()
    {
        if (Interaction == true)
        {
            pressOpen.enabled = true;    
            if (Input.GetKey(KeyCode.E))
            {
                seedUI.SetActive(true);
            }   
        }
        else
        {
            pressOpen.enabled = false;
        }
  
    }

    private void OnTriggerEnter2D(Collider2D other)
    {
       if (other.tag == "Player")
       {
           Interaction = true;
           
       }
        
    }
    private void OnTriggerExit2D(Collider2D other)
    {
       if (other.tag == "Player")
       {
           Interaction = false;
           seedUI.SetActive(false);
           
       }  
    }

    //Buttons
    public void CloseButton()
    {
        seedUI.SetActive(false);
    }
  /*  public void Seed0()
    {

        Debug.Log("Peguei a semente de cenoura");
        GameObject spawnedSeed = Instantiate(CarrotSeedPrefab, SpawnPoint.transform.position, Quaternion.identity) as GameObject;
        spawnedSeed.transform.SetParent(Player.gameObject.transform);
        Player.gameObject.GetComponent<Player>().seedStallButton();  
    }
    public void Seed1()
    {
        Debug.Log("Peguei a semente de cenoura dark");
        GameObject spawnedSeed = Instantiate(DarkCarrotSeed, SpawnPoint.transform.position, Quaternion.identity) as GameObject;
        spawnedSeed.transform.SetParent(Player.gameObject.transform);
        Player.gameObject.GetComponent<Player>().seedStallButton(); 
    }
    public void Seed2()
    {
        Debug.Log("Peguei a semente de abacaxi");
        GameObject spawnedSeed = Instantiate(PineappleSeed, SpawnPoint.transform.position, Quaternion.identity) as GameObject;
        spawnedSeed.transform.SetParent(Player.gameObject.transform);
        Player.gameObject.GetComponent<Player>().seedStallButton(); 
    }*/
}
